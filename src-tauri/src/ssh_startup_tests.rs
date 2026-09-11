use super::*;

#[tokio::test(start_paused = true)]
async fn overdue_timer_cannot_expire_a_prompt_when_its_wakeup_is_delayed() {
    let budget = SshStartupBudget::new(SSH_STARTUP_TIMEOUT);
    let expiry = budget.expired();
    tokio::pin!(expiry);
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(expiry.as_mut().poll(cx).is_pending()))
            .await
    );
    let input = budget.wait_for_input(std::future::pending::<()>());
    tokio::pin!(input);
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(input.as_mut().poll(cx).is_pending()))
            .await
    );
    // Both the old timer and the pause notification are now ready to poll.
    tokio::time::advance(Duration::from_secs(20)).await;
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(expiry.as_mut().poll(cx).is_pending()))
            .await
    );
}

#[tokio::test(start_paused = true)]
async fn machine_budget_resumes_after_prompt_and_is_not_reset_between_stages() {
    for timeout in [SSH_STARTUP_TIMEOUT, SSH_TMUX_RESUME_TIMEOUT] {
        let budget = SshStartupBudget::new(timeout);
        let cancel = CancellationToken::new();
        let start = tokio::time::Instant::now();
        let startup = async {
            tokio::time::sleep(Duration::from_secs(3)).await;
            budget
                .wait_for_input(tokio::time::sleep(Duration::from_secs(20)))
                .await;
            // A peer may send keepalives while authentication/channel setup stalls.
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            #[allow(unreachable_code)]
            Ok::<(), String>(())
        };
        let error = run_terminal_startup(startup, &budget, &cancel)
            .await
            .unwrap_err();
        assert!(error.contains("timed out"));
        assert_eq!(start.elapsed(), timeout + Duration::from_secs(20));
    }
}

#[test]
fn close_joins_worker_while_startup_is_waiting_for_input_auth_or_channel() {
    for prompt in [false, true] {
        let cancel = CancellationToken::new();
        let worker_cancel = cancel.clone();
        let (started_tx, started_rx) = std_mpsc::sync_channel(1);
        let (control, mut control_rx) = mpsc::unbounded_channel();
        let (worker_tx, _worker_rx) = mpsc::unbounded_channel();
        let worker = thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async {
                    let budget = SshStartupBudget::new(SSH_STARTUP_TIMEOUT);
                    let startup = async {
                        started_tx.send(()).unwrap();
                        if prompt {
                            let _ = budget
                                .wait_for_input(read_terminal_prompt_input(
                                    &mut control_rx,
                                    false,
                                    |_| {},
                                ))
                                .await;
                        }
                        std::future::pending::<Result<(), String>>().await
                    };
                    // Bound a failed regression test as well as the close assertion.
                    let result = tokio::time::timeout(
                        Duration::from_secs(3),
                        run_terminal_startup(startup, &budget, &worker_cancel),
                    )
                    .await;
                    assert_eq!(result.unwrap().unwrap(), None);
                });
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let terminal = NativeSshTerminal {
            session_id: "startup-close-test".into(),
            control,
            cancel_startup: cancel,
            worker_tx,
            worker: Some(worker),
            terminal_ready_ms: None,
            x11_forwarding_status: None,
        };
        let (closed_tx, closed_rx) = std_mpsc::sync_channel(1);
        let closer = thread::spawn(move || {
            terminal.close();
            closed_tx.send(()).unwrap();
        });
        closed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("close must not wait for the startup deadline");
        closer.join().unwrap();
    }
}

#[test]
fn readiness_timeout_closes_a_worker_that_has_finished_startup() {
    let cancel_startup = CancellationToken::new();
    let worker_cancel = cancel_startup.clone();
    let (control, mut control_rx) = mpsc::unbounded_channel();
    let rescue_control = control.clone();
    let (worker_tx, _worker_rx) = mpsc::unbounded_channel();
    let (ready_tx, ready_rx) = std_mpsc::sync_channel(1);
    let (started_tx, started_rx) = std_mpsc::sync_channel(1);
    let (late_ready_tx, late_ready_rx) = std_mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let budget = SshStartupBudget::new(SSH_STARTUP_TIMEOUT);
                assert_eq!(
                    run_terminal_startup(async { Ok::<_, String>(()) }, &budget, &worker_cancel)
                        .await.unwrap(),
                    Some(()),
                );
                started_tx.send(()).unwrap();
                // Force readiness publication to race the caller's timeout,
                // after startup has stopped observing the cancellation token.
                tokio::time::timeout(Duration::from_secs(3), worker_cancel.cancelled())
                    .await.expect("startup timeout must cancel the worker");
                late_ready_tx.send(ready_tx.send(Ok((0, None))).is_err()).unwrap();
                assert!(matches!(
                    tokio::time::timeout(Duration::from_secs(3), control_rx.recv()).await,
                    Ok(Some(SshTerminalControl::Close)),
                ));
            });
    });
    started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    let terminal = NativeSshTerminal {
        session_id: "ready-timeout-race".into(),
        control,
        cancel_startup,
        worker_tx,
        worker: Some(worker),
        terminal_ready_ms: None,
        x11_forwarding_status: None,
    };
    let (finished_tx, finished_rx) = std_mpsc::sync_channel(1);
    let waiter = thread::spawn(move || {
        let error = terminal.wait_until_ready(ready_rx, Duration::ZERO).err();
        finished_tx.send(error).unwrap();
    });
    let result = finished_rx.recv_timeout(Duration::from_secs(1));
    // Release a regressed implementation before failing, so the test never hangs.
    if result.is_err() {
        let _ = rescue_control.send(SshTerminalControl::Close);
    }
    waiter.join().unwrap();
    assert!(result.expect("timeout cleanup must finish promptly").unwrap().contains("timed out"));
    assert!(late_ready_rx.recv().unwrap(), "late readiness/error notifications must not fill a receiver retained during join");
}

#[test]
fn zero_millisecond_readiness_is_distinct_from_pending_authentication() {
    let (control, _control_rx) = mpsc::unbounded_channel();
    let (worker_tx, _worker_rx) = mpsc::unbounded_channel();
    let terminal = NativeSshTerminal {
        session_id: "ready-zero".into(),
        control,
        cancel_startup: CancellationToken::new(),
        worker_tx,
        worker: None,
        terminal_ready_ms: None,
        x11_forwarding_status: None,
    };
    assert_eq!(terminal.terminal_ready_ms(), None);
    let (ready_tx, ready_rx) = std_mpsc::sync_channel(1);
    ready_tx.send(Ok((0, Some(NativeSshX11ForwardingStatus::Rejected)))).unwrap();
    let terminal = terminal.wait_until_ready(ready_rx, Duration::ZERO).ok().unwrap();
    assert_eq!(terminal.terminal_ready_ms(), Some(0));
    assert_eq!(terminal.x11_forwarding_status(), Some(NativeSshX11ForwardingStatus::Rejected));
    terminal.close();
}

#[derive(Default)]
struct StartupServer {
    channel: Option<Channel<russh::server::Msg>>,
    stall: Option<StallStage>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StallStage {
    Authentication,
    Channel,
}

impl russh::server::Handler for StartupServer {
    type Error = russh::Error;
    async fn auth_publickey(
        &mut self,
        _: &str,
        _: &russh::keys::ssh_key::PublicKey,
    ) -> Result<russh::server::Auth, Self::Error> {
        if self.stall == Some(StallStage::Authentication) {
            std::future::pending::<()>().await;
        }
        Ok(russh::server::Auth::Accept)
    }
    async fn channel_open_session(
        &mut self,
        channel: Channel<russh::server::Msg>,
        reply: russh::server::ChannelOpenHandle,
        _: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        if self.stall == Some(StallStage::Channel) {
            std::future::pending::<()>().await;
        }
        reply.accept().await;
        self.channel = Some(channel);
        Ok(())
    }
    async fn x11_request(
        &mut self,
        channel: russh::ChannelId,
        _: bool,
        _: &str,
        _: &str,
        _: u32,
        session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, b"pre-shell output".as_slice())?;
        session.channel_failure(channel)
    }
    async fn shell_request(
        &mut self,
        channel: russh::ChannelId,
        session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, b"shell ready".as_slice())
    }
}

#[tokio::test(start_paused = true)]
async fn encrypted_key_prompt_over_15_seconds_authenticates_and_x11_rejection_keeps_shell() {
    encrypted_key_startup(None).await;
}

#[tokio::test(start_paused = true)]
async fn server_stalling_public_key_auth_after_passphrase_times_out() {
    encrypted_key_startup(Some(StallStage::Authentication)).await;
}

#[tokio::test(start_paused = true)]
async fn server_stalling_channel_open_after_passphrase_times_out() {
    encrypted_key_startup(Some(StallStage::Channel)).await;
}

async fn encrypted_key_startup(stall: Option<StallStage>) {
    let files = tempfile::tempdir().unwrap();
    let key_path = files.path().join("client-key");
    assert!(
        std::process::Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "test-passphrase", "-f"])
            .arg(&key_path)
            .status()
            .unwrap()
            .success()
    );
    let host_key = russh::keys::ssh_key::PrivateKey::random(
        &mut rand::rng(),
        russh::keys::ssh_key::Algorithm::Ed25519,
    )
    .unwrap();
    let known_hosts = files.path().join("known-hosts");
    trust_host_key(
        known_hosts.clone(),
        TrustSshHostKeyRequest {
            host: "test-host".into(),
            port: Some(22),
            public_key: host_key.public_key().to_openssh().unwrap(),
            replace: false,
        },
    )
    .unwrap();
    let config = russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    };
    let (client_io, server_io) = tokio::io::duplex(65536);
    let server = tokio::spawn(async move {
        let _ = russh::server::run_stream(
            Arc::new(config),
            server_io,
            StartupServer {
                stall,
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .await;
    });
    let mut client = client::connect_stream(
        Arc::new(native_ssh_client_config(false, false)),
        client_io,
        VerifyingClient {
            host: "test-host".into(),
            port: 22,
            known_hosts_path: known_hosts,
            rejection: Default::default(),
            x11_forwarding: None,
            remote_forward_targets: None,
            bridge_tasks: None,
        },
    )
    .await
    .unwrap();
    let budget = SshStartupBudget::new(SSH_STARTUP_TIMEOUT);
    let started = tokio::time::Instant::now();
    let cancel = CancellationToken::new();
    let (input_tx, mut input_rx) = mpsc::unbounded_channel();
    let output = std::cell::RefCell::new(String::new());
    let startup = async {
        let entered = budget
            .wait_for_input(read_terminal_prompt_input(&mut input_rx, false, |text| {
                output.borrow_mut().push_str(text)
            }))
            .await?;
        authenticate_native_ssh(
            &mut client,
            "test",
            &NativeSshAuth::KeyFile {
                key_path: key_path.to_string_lossy().into_owned(),
                passphrase: Some(entered),
            },
            None,
        )
        .await?;
        let mut channel = client
            .channel_open_session()
            .await
            .map_err(|error| error.to_string())?;
        let mut pending = VecDeque::new();
        let status = request_x11_forwarding(&mut channel, &mut pending).await?;
        assert_eq!(status, NativeSshX11ForwardingStatus::Rejected);
        assert!(
            matches!(pending.pop_front(), Some(ChannelMsg::Data { data }) if data.as_ref() == b"pre-shell output")
        );
        channel.request_shell(false).await.unwrap();
        assert!(
            matches!(channel.wait().await, Some(ChannelMsg::Data { data }) if data.as_ref() == b"shell ready")
        );
        let event = serde_json::to_value(NativeSshTerminalReady {
            session_id: "prompt-session".into(),
            terminal_ready_ms: 1,
            x11_forwarding_status: Some(status),
        })
        .unwrap();
        assert_eq!(event["sessionId"], "prompt-session");
        assert_eq!(event["x11ForwardingStatus"], "rejected");
        Ok(())
    };
    let input = async {
        tokio::time::sleep(Duration::from_secs(20)).await;
        input_tx
            .send(SshTerminalControl::Input(b"test-passphrase\r".to_vec()))
            .unwrap();
    };
    let (result, ()) = tokio::join!(run_terminal_startup(startup, &budget, &cancel), input);
    if stall.is_some() {
        assert!(result.unwrap_err().contains("timed out"));
        assert_eq!(started.elapsed(), Duration::from_secs(35));
    } else {
        assert_eq!(result.unwrap(), Some(()));
    }
    assert_eq!(*output.borrow(), "\r\n", "passphrase must not be echoed");
    client
        .disconnect(Disconnect::ByApplication, "test complete", "en")
        .await
        .unwrap();
    server.abort();
    let _ = server.await;
}
