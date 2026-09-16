//! Windows Graphics Capture with GPU-resident crops and Windows H.264 encoding.
//! One latest surface is retained; slow encoders never accumulate capture frames.
use crate::screenshot::RecordingRect;
use std::{
    path::Path,
    sync::{Arc, Condvar, Mutex, mpsc},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use windows::{
    Foundation::{TimeSpan, TypedEventHandler},
    Graphics::DirectX::Direct3D11::IDirect3DSurface,
    Media::{
        Core::{
            MediaStreamSample, MediaStreamSource, MediaStreamSourceSampleRequestedEventArgs,
            MediaStreamSourceStartingEventArgs, VideoStreamDescriptor,
        },
        MediaProperties::{
            MediaEncodingProfile, MediaEncodingSubtypes, VideoEncodingProperties,
            VideoEncodingQuality,
        },
        Transcoding::MediaTranscoder,
    },
    Storage::{FileAccessMode, StorageFile},
    System::Threading::{ThreadPool, WorkItemHandler, WorkItemOptions, WorkItemPriority},
    Win32::{
        Graphics::{
            Direct3D11::{
                D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_BOX,
                D3D11_USAGE_DEFAULT, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread,
                ID3D11Texture2D,
            },
            Dxgi::IDXGISurface,
            Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO},
        },
        System::WinRT::{
            Direct3D11::CreateDirect3D11SurfaceFromDXGISurface, RO_INIT_MULTITHREADED,
            RoInitialize, RoUninitialize,
        },
    },
    core::{AgileReference, HSTRING, Interface},
};
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
};

type CaptureError = Box<dyn std::error::Error + Send + Sync>;

struct Frames {
    surface: Option<AgileReference<IDirect3DSurface>>,
    epoch: Instant,
    paused_at: Option<Instant>,
    paused_for: Duration,
    next_tick: u64,
    running: bool,
    sampled: bool,
    stopped: bool,
    error: Option<String>,
}

struct Shared {
    frames: Mutex<Frames>,
    changed: Condvar,
    rate: u32,
}

impl Shared {
    fn new(rate: u32) -> Self {
        Self {
            frames: Mutex::new(Frames {
                surface: None,
                epoch: Instant::now(),
                paused_at: None,
                paused_for: Duration::ZERO,
                next_tick: 0,
                running: false,
                sampled: false,
                stopped: false,
                error: None,
            }),
            changed: Condvar::new(),
            rate,
        }
    }

    fn stop(&self) {
        self.frames.lock().unwrap().stopped = true;
        self.changed.notify_all();
    }

    fn pause(&self, paused: bool) {
        let mut frames = self.frames.lock().unwrap();
        if paused && frames.paused_at.is_none() {
            frames.paused_at = Some(Instant::now());
        } else if !paused && let Some(start) = frames.paused_at.take() {
            frames.paused_for += start.elapsed();
        }
        self.changed.notify_all();
    }

    // Called on the Windows worker pool, never the capture or MSS event thread.
    // Repeat the latest immutable surface for static desktops; skip missed ticks
    // when encoding is slow, preserving elapsed time without an unbounded queue.
    fn next_sample(&self) -> windows::core::Result<Option<MediaStreamSample>> {
        let mut frames = self.frames.lock().unwrap();
        loop {
            if frames.stopped {
                return Ok(None);
            }
            let elapsed = frames.epoch.elapsed().saturating_sub(frames.paused_for);
            let due = Duration::from_nanos(frames.next_tick * 1_000_000_000 / u64::from(self.rate));
            if frames.running
                && frames.paused_at.is_none()
                && let Some(surface) = frames.surface.clone()
            {
                if elapsed >= due {
                    let tick = (elapsed.as_nanos() * u128::from(self.rate) / 1_000_000_000) as u64;
                    frames.next_tick = tick + 1;
                    drop(frames);
                    let sample = MediaStreamSample::CreateFromDirect3D11Surface(
                        &surface.resolve()?,
                        TimeSpan {
                            Duration: (tick * 10_000_000 / u64::from(self.rate)) as i64,
                        },
                    )?;
                    sample.SetDuration(TimeSpan {
                        Duration: 10_000_000 / i64::from(self.rate),
                    })?;
                    return Ok(Some(sample));
                }
            }
            let wait = if !frames.running || frames.paused_at.is_some() || frames.surface.is_none()
            {
                Duration::from_secs(1)
            } else {
                due.saturating_sub(elapsed)
            };
            frames = self.changed.wait_timeout(frames, wait).unwrap().0;
        }
    }
}

struct Capture {
    shared: Arc<Shared>,
    crop: (u32, u32, u32, u32),
    last_copy_tick: Option<i128>,
}

impl GraphicsCaptureApiHandler for Capture {
    type Flags = (Arc<Shared>, (u32, u32, u32, u32));
    type Error = CaptureError;
    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        // Capture and MediaStreamSource use this device from different threads.
        // The Rust frame mutex only protects the surface reference, not D3D11's
        // immediate context; enable the runtime's lock before publishing frames.
        let multithread: ID3D11Multithread = ctx.device_context.cast()?;
        unsafe {
            let _ = multithread.SetMultithreadProtected(true);
        }
        Ok(Self {
            shared: ctx.flags.0,
            crop: ctx.flags.1,
            last_copy_tick: None,
        })
    }
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        {
            let state = self.shared.frames.lock().unwrap();
            if state.stopped {
                control.stop();
                return Ok(());
            }
        }
        // Use source-time buckets, not "last copy + interval": arrival jitter
        // near the selected refresh rate must not repeatedly skip every other frame.
        let tick =
            i128::from(frame.timestamp()?.Duration) * i128::from(self.shared.rate) / 10_000_000;
        if self.last_copy_tick.is_some_and(|last| tick <= last) {
            return Ok(());
        }
        let (x, y, width, height) = self.crop;
        if x + width > frame.width() || y + height > frame.height() {
            self.on_closed()?;
            control.stop();
            return Ok(());
        }
        let surface = copy_surface(
            frame.device(),
            frame.device_context(),
            frame.as_raw_texture(),
            self.crop,
        )?;
        self.shared.frames.lock().unwrap().surface = Some(AgileReference::new(&surface)?);
        self.shared.changed.notify_all();
        self.last_copy_tick = Some(tick);
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), Self::Error> {
        let mut state = self.shared.frames.lock().unwrap();
        state.error = Some("The recording display closed or changed size".to_string());
        state.stopped = true;
        self.shared.changed.notify_all();
        Ok(())
    }
}

fn copy_surface(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    source_texture: &ID3D11Texture2D,
    crop: (u32, u32, u32, u32),
) -> Result<IDirect3DSurface, CaptureError> {
    let (x, y, width, height) = crop;
    let mut desc = Default::default();
    unsafe {
        source_texture.GetDesc(&mut desc);
    }
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = (D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE).0 as u32;
    desc.CPUAccessFlags = 0;
    desc.MiscFlags = 0;
    let mut texture: Option<ID3D11Texture2D> = None;
    unsafe {
        device.CreateTexture2D(&desc, None, Some(&mut texture))?;
    }
    let texture = texture.ok_or("Windows capture did not create a texture")?;
    let source = D3D11_BOX {
        left: x,
        top: y,
        front: 0,
        right: x + width,
        bottom: y + height,
        back: 1,
    };
    unsafe {
        context.CopySubresourceRegion(&texture, 0, 0, 0, 0, source_texture, 0, Some(&source));
        context.Flush();
    }
    let dxgi: IDXGISurface = texture.cast()?;
    let surface: IDirect3DSurface =
        unsafe { CreateDirect3D11SurfaceFromDXGISurface(&dxgi)? }.cast()?;
    Ok(surface)
}

fn monitor_crop(rect: &RecordingRect) -> Result<(Monitor, (u32, u32, u32, u32)), String> {
    for monitor in Monitor::enumerate().map_err(|e| e.to_string())? {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !unsafe { GetMonitorInfoW(HMONITOR(monitor.as_raw_hmonitor()), &mut info) }.as_bool() {
            continue;
        }
        let screen = info.rcMonitor;
        if let Some(crop) = crop_within(rect, screen.left, screen.top, screen.right, screen.bottom)
        {
            return Ok((monitor, crop));
        }
    }
    Err("The recording spans monitors; using the compatible desktop recorder".to_string())
}

fn crop_within(
    rect: &RecordingRect,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) -> Option<(u32, u32, u32, u32)> {
    if rect.width < 2
        || rect.height < 2
        || rect.x < left
        || rect.y < top
        || i64::from(rect.x) + i64::from(rect.width) > i64::from(right)
        || i64::from(rect.y) + i64::from(rect.height) > i64::from(bottom)
    {
        return None;
    }
    Some((
        (rect.x - left) as u32,
        (rect.y - top) as u32,
        rect.width as u32 & !1,
        rect.height as u32 & !1,
    ))
}

pub(super) struct NativeRecording {
    capture: Option<CaptureControl<Capture, CaptureError>>,
    shared: Arc<Shared>,
    encoder: Option<JoinHandle<Result<(), String>>>,
}

impl NativeRecording {
    pub(super) fn start(rect: &RecordingRect, rate: u32, path: &Path, use_gpu: bool) -> Result<Self, String> {
        let (monitor, crop) = monitor_crop(rect)?;
        let shared = Arc::new(Shared::new(rate));
        let settings = Settings::new(
            monitor,
            CursorCaptureSettings::Default,
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            (shared.clone(), crop),
        );
        let capture = Capture::start_free_threaded(settings).map_err(|e| e.to_string())?;
        let mut recording = Self {
            capture: Some(capture),
            shared: shared.clone(),
            encoder: None,
        };
        {
            let state = shared.frames.lock().unwrap();
            let (mut state, _) = shared
                .changed
                .wait_timeout_while(state, Duration::from_secs(3), |s| {
                    s.surface.is_none() && !s.stopped
                })
                .unwrap();
            if state.surface.is_none() || state.stopped {
                return Err("Windows capture did not deliver a frame".to_string());
            }
            state.epoch = Instant::now();
        }
        let path = path.to_path_buf();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        recording.encoder = Some(std::thread::spawn(move || {
            let result = encode(&shared, &path, crop.2, crop.3, use_gpu, ready_tx);
            let mut state = shared.frames.lock().unwrap();
            if let Err(error) = &result {
                state.error = Some(error.clone());
            }
            state.stopped = true;
            shared.changed.notify_all();
            result
        }));
        match ready_rx.recv() {
            Ok(Ok(())) => {
                let state = recording.shared.frames.lock().unwrap();
                let (state, _) = recording
                    .shared
                    .changed
                    .wait_timeout_while(state, Duration::from_secs(3), |s| !s.sampled && !s.stopped)
                    .unwrap();
                let ready = state.sampled && !state.stopped;
                let error = state.error.clone();
                drop(state);
                if ready {
                    Ok(recording)
                } else {
                    Err(error.unwrap_or_else(|| {
                        "Windows encoder did not accept a video sample".to_string()
                    }))
                }
            }
            Ok(Err(error)) => Err(error),
            Err(_) => Err("Windows video encoder failed to initialize".to_string()),
        }
    }

    pub(super) fn pause(&self, paused: bool) {
        self.shared.pause(paused);
    }

    pub(super) fn finish(&mut self) -> Result<(), String> {
        self.shared.stop();
        let capture_result = self
            .capture
            .take()
            .map(|c| c.stop().map_err(|e| e.to_string()))
            .unwrap_or(Ok(()));
        let encoder_result = match self.encoder.take() {
            Some(encoder) => encoder
                .join()
                .map_err(|_| "Windows encoder thread failed".to_string())?,
            None => Ok(()),
        };
        capture_result?;
        encoder_result?;
        if let Some(error) = self.shared.frames.lock().unwrap().error.clone() {
            return Err(error);
        }
        Ok(())
    }
}

impl Drop for NativeRecording {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

fn encode(
    shared: &Arc<Shared>,
    path: &Path,
    width: u32,
    height: u32,
    use_gpu: bool,
    ready: mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let result = (|| -> windows::core::Result<()> {
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED)?;
        }
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    RoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let input = VideoEncodingProperties::CreateUncompressed(
            &MediaEncodingSubtypes::Bgra8()?,
            width,
            height,
        )?;
        input.FrameRate()?.SetNumerator(shared.rate)?;
        input.FrameRate()?.SetDenominator(1)?;
        let descriptor = VideoStreamDescriptor::Create(&input)?;
        let source = MediaStreamSource::CreateFromDescriptor(&descriptor)?;
        source.SetBufferTime(TimeSpan { Duration: 0 })?;
        let starting = source.Starting(&TypedEventHandler::<
            MediaStreamSource,
            MediaStreamSourceStartingEventArgs,
        >::new(|_, event| {
            if let Some(event) = event.as_ref() {
                event
                    .Request()?
                    .SetActualStartPosition(TimeSpan { Duration: 0 })?;
            }
            Ok(())
        }))?;
        let frames = shared.clone();
        let requested = source.SampleRequested(&TypedEventHandler::<
            MediaStreamSource,
            MediaStreamSourceSampleRequestedEventArgs,
        >::new(move |_, event| {
            let Some(event) = event.as_ref() else {
                return Ok(());
            };
            let request = event.Request()?;
            let deferral = request.GetDeferral()?;
            let failed_deferral = deferral.clone();
            let worker_frames = frames.clone();
            let scheduled = ThreadPool::RunWithPriorityAndOptionsAsync(
                &WorkItemHandler::new(move |_| {
                    let result = worker_frames
                        .next_sample()
                        .and_then(|sample| request.SetSample(sample.as_ref()));
                    let complete = deferral.Complete();
                    let result = result.and(complete);
                    let mut state = worker_frames.frames.lock().unwrap();
                    match &result {
                        Ok(()) => state.sampled = true,
                        Err(error) => {
                            state.error = Some(error.to_string());
                            state.stopped = true;
                        }
                    }
                    worker_frames.changed.notify_all();
                    result
                }),
                WorkItemPriority::Normal,
                WorkItemOptions::None,
            );
            if let Err(error) = scheduled {
                let _ = failed_deferral.Complete();
                let mut state = frames.frames.lock().unwrap();
                state.error = Some(error.to_string());
                state.stopped = true;
                frames.changed.notify_all();
                return Err(error);
            }
            Ok(())
        }))?;
        let profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD1080p)?;
        profile.SetAudio(None)?;
        let video = profile.Video()?;
        video.SetWidth(width)?;
        video.SetHeight(height)?;
        video.FrameRate()?.SetNumerator(shared.rate)?;
        video.FrameRate()?.SetDenominator(1)?;
        // Scale bitrate with pixels and rate, bounded for practical desktop use.
        let bitrate = (u64::from(width) * u64::from(height) * u64::from(shared.rate) / 6)
            .clamp(4_000_000, 80_000_000);
        video.SetBitrate(bitrate as u32)?;
        std::fs::File::create(path).map_err(|e| {
            windows::core::Error::new(windows::core::HRESULT(0x80004005u32 as i32), e.to_string())
        })?;
        let canonical = std::fs::canonicalize(path).map_err(|e| {
            windows::core::Error::new(windows::core::HRESULT(0x80004005u32 as i32), e.to_string())
        })?;
        let canonical = canonical.to_string_lossy();
        let storage_path = if let Some(unc) = canonical.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else {
            canonical
                .strip_prefix(r"\\?\")
                .unwrap_or(&canonical)
                .to_string()
        };
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(storage_path))?.join()?;
        let stream = file.OpenAsync(FileAccessMode::ReadWrite)?.join()?;
        let transcoder = MediaTranscoder::new()?;
        // GPU is the default. CPU remains available to avoid intermittent
        // hardware-path corruption seen at 4K/60 fps with some drivers.
        transcoder.SetHardwareAccelerationEnabled(use_gpu)?;
        let prepared = transcoder
            .PrepareMediaStreamSourceTranscodeAsync(&source, &stream, &profile)?
            .join()?;
        if !prepared.CanTranscode()? {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80004005u32 as i32),
                format!(
                    "Windows encoder is unavailable: {:?}",
                    prepared.FailureReason()?
                ),
            ));
        }
        // Start the media clock after preparation so initialization time is excluded.
        {
            let mut state = shared.frames.lock().unwrap();
            state.epoch = Instant::now();
            state.running = true;
        }
        shared.changed.notify_all();
        let action = prepared.TranscodeAsync()?;
        let _ = ready.send(Ok(()));
        let result = action.join();
        let _ = source.RemoveSampleRequested(requested);
        let _ = source.RemoveStarting(starting);
        stream.Close()?;
        result
    })()
    .map_err(|e| e.to_string());
    if let Err(error) = &result {
        let _ = ready.send(Err(error.clone()));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires a Windows hardware D3D11 device"]
    fn capture_protects_context_shared_with_media_encoder() {
        let (device, device_context) = windows_capture::d3d11::create_d3d_device().unwrap();
        let multithread: ID3D11Multithread = device_context.cast().unwrap();
        let _capture = Capture::new(Context {
            flags: (Arc::new(Shared::new(60)), (0, 0, 3840, 2160)),
            device,
            device_context,
        })
        .unwrap();
        assert!(
            unsafe { multithread.GetMultithreadProtected() }.as_bool(),
            "capture and MediaStreamSource must not race the immediate context"
        );
    }

    #[test]
    #[ignore = "requires a Windows hardware D3D11 device, H.264 encoder, and ffmpeg"]
    fn native_encoder_preserves_complete_4k_frames() {
        use windows::Win32::Graphics::{
            Direct3D11::D3D11_TEXTURE2D_DESC,
            Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC},
        };
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).unwrap();
        }
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    RoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let (device, context) = windows_capture::d3d11::create_d3d_device().unwrap();
        let shared = Arc::new(Shared::new(60));
        // Exercise the same device setup as a real capture session.
        let _capture = Capture::new(Context {
            flags: (shared.clone(), (0, 0, 3840, 2160)),
            device: device.clone(),
            device_context: context.clone(),
        })
        .unwrap();
        let desc = D3D11_TEXTURE2D_DESC {
            Width: 3840,
            Height: 2160,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE).0 as u32,
            ..Default::default()
        };
        let mut texture = None;
        unsafe {
            device
                .CreateTexture2D(&desc, None, Some(&mut texture))
                .unwrap();
        }
        let texture = texture.unwrap();
        let mut view = None;
        unsafe {
            device
                .CreateRenderTargetView(&texture, None, Some(&mut view))
                .unwrap();
        }
        let view = view.unwrap();
        let publish = |value| {
            unsafe {
                context.ClearRenderTargetView(&view, &[value, value, value, 1.0]);
            }
            let surface = copy_surface(&device, &context, &texture, (0, 0, 3840, 2160)).unwrap();
            shared.frames.lock().unwrap().surface = Some(AgileReference::new(&surface).unwrap());
            shared.changed.notify_all();
        };
        publish(0.5);
        let path = std::env::temp_dir().join(format!(
            "kkterm-native-4k-pixels-{}.mp4",
            super::super::now_millis()
        ));
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let encoder_shared = shared.clone();
        let encoder_path = path.clone();
        let mut recording = NativeRecording {
            capture: None,
            shared: shared.clone(),
            encoder: Some(std::thread::spawn(move || {
                encode(&encoder_shared, &encoder_path, 3840, 2160, false, ready_tx)
            })),
        };
        ready_rx.recv().unwrap().unwrap();
        let epoch = Instant::now();
        for tick in 0..900 {
            // First repeat a static capture for ten seconds, then alternate
            // complete gray frames for five seconds to stress capture/encode.
            if tick >= 600 {
                publish(if tick % 2 == 0 { 0.25 } else { 0.75 });
            }
            // Model a brief scheduling stall: missed output ticks must not
            // expose incomplete surfaces when sampling resumes.
            if tick == 300 {
                let _state = shared.frames.lock().unwrap();
                std::thread::sleep(Duration::from_millis(100));
            }
            std::thread::sleep(
                Duration::from_nanos((tick + 1) * 1_000_000_000 / 60)
                    .saturating_sub(epoch.elapsed()),
            );
        }
        recording.finish().unwrap();
        let decoded = std::process::Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args([
                "-vf",
                "scale=64:36",
                "-pix_fmt",
                "gray",
                "-f",
                "rawvideo",
                "-",
            ])
            .output()
            .unwrap();
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        assert!(
            decoded.stdout.len() >= 64 * 36 * 600,
            "too few decoded frames"
        );
        let mut corrupted = Vec::new();
        for (index, frame) in decoded.stdout.chunks_exact(64 * 36).enumerate() {
            let min = *frame.iter().min().unwrap();
            let max = *frame.iter().max().unwrap();
            if min < 45 || max - min > 8 {
                corrupted.push((index, min, max));
            }
        }
        assert!(
            corrupted.is_empty(),
            "partial solid-color frames in {}: {corrupted:?}",
            path.display()
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn monitor_crop_handles_negative_origins_and_rejects_spanning_targets() {
        let rect = RecordingRect {
            x: -1800,
            y: 50,
            width: 801,
            height: 601,
        };
        assert_eq!(
            crop_within(&rect, -1920, 0, 0, 1080),
            Some((120, 50, 800, 600))
        );
        assert!(crop_within(&rect, 0, 0, 1920, 1080).is_none());
        let spanning = RecordingRect {
            x: -10,
            y: 0,
            width: 100,
            height: 100,
        };
        assert!(crop_within(&spanning, -1920, 0, 0, 1080).is_none());
    }

    #[test]
    #[ignore = "records the local Windows desktop; requires ffprobe"]
    fn native_capture_records_each_rate_and_excludes_pauses() {
        let monitor = Monitor::primary().unwrap();
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        assert!(
            unsafe { GetMonitorInfoW(HMONITOR(monitor.as_raw_hmonitor()), &mut info) }.as_bool()
        );
        let rect = RecordingRect {
            x: info.rcMonitor.left + 10,
            y: info.rcMonitor.top + 10,
            width: 1280,
            height: 720,
        };
        for rate in [30, 60, 120] {
            let path = std::env::temp_dir().join(format!(
                "kkterm-native-smoke-{}-{rate}.mp4",
                super::super::now_millis()
            ));
            let mut recording = NativeRecording::start(&rect, rate, &path, false)
                .expect("native capture starts without fallback");
            std::thread::sleep(Duration::from_millis(1200));
            recording.pause(true);
            let before = recording.shared.frames.lock().unwrap().next_tick;
            std::thread::sleep(Duration::from_millis(1000));
            assert_eq!(
                before,
                recording.shared.frames.lock().unwrap().next_tick,
                "paused media clock must stop"
            );
            recording.pause(false);
            std::thread::sleep(Duration::from_millis(1200));
            recording.finish().expect("native encoding completes");
            let metadata = super::super::probe_video(&path).expect("native MP4 is readable");
            assert_eq!((metadata.0, metadata.1), (1280, 720));
            assert!(
                (1800..3000).contains(&metadata.2),
                "pause must be excluded: {metadata:?}"
            );
            eprintln!("native {rate} fps: {metadata:?}");
            std::fs::remove_file(path).unwrap();
        }
    }
}
