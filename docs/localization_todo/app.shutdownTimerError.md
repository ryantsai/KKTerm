# app.shutdownTimerError

- **English value**: `Could not change scheduled shutdown: {{message}}`
- **Namespace**: `app`
- **File/component**: `src/modules/workspace/StatusBar.tsx`
- **UI role**: `error`
- **User flow**: Shown when scheduling, canceling, opening the warning window, or requesting OS shutdown fails.
- **Tone**: concise error
- **Placeholders**: `{{message}}`
- **Context/meaning**: Reports a failure in the local computer shutdown schedule.
- **Domain notes**: Preserve the operating-system error in `{{message}}`.
