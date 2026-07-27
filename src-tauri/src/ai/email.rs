#[allow(unused_imports)]
use super::*;

#[derive(Debug)]
pub(crate) struct EmailToolRequest {
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    reply_to: Option<String>,
    subject: String,
    text: Option<String>,
    html: Option<String>,
}

pub(crate) async fn send_email_tool(settings: &AiProviderSettings, args: Value) -> String {
    let request = match parse_email_tool_request(args) {
        Ok(request) => request,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    if settings.email_from().trim().is_empty() {
        return json!({"ok": false, "error": "Send Email requires a sender address in Settings."})
            .to_string();
    }

    match settings.email_provider() {
        "resend" => send_email_resend(settings, &request).await,
        "sendgrid" => send_email_sendgrid(settings, &request).await,
        "mailgun" => send_email_mailgun(settings, &request).await,
        "postmark" => send_email_postmark(settings, &request).await,
        "smtp" => send_email_smtp(settings, &request),
        _ => json!({"ok": false, "error": "Unknown Send Email provider configured."}).to_string(),
    }
}

pub(crate) fn parse_email_tool_request(args: Value) -> Result<EmailToolRequest, String> {
    let to = email_array_arg(&args, "to");
    let cc = email_array_arg(&args, "cc");
    let bcc = email_array_arg(&args, "bcc");
    if to.is_empty() {
        return Err("send_email requires at least one recipient.".to_string());
    }
    for address in to.iter().chain(cc.iter()).chain(bcc.iter()) {
        validate_email_address(address)?;
    }
    let reply_to = optional_email_arg(&args, "replyTo")?;
    let subject = arg_string(&args, "subject");
    if subject.is_empty() {
        return Err("send_email requires subject.".to_string());
    }
    if subject.chars().any(|ch| ch == '\r' || ch == '\n') {
        return Err("send_email subject cannot contain line breaks.".to_string());
    }
    let text = optional_body_arg(&args, "text");
    let html = optional_body_arg(&args, "html");
    if text.is_none() && html.is_none() {
        return Err("send_email requires text or html body.".to_string());
    }

    Ok(EmailToolRequest {
        to,
        cc,
        bcc,
        reply_to,
        subject,
        text,
        html,
    })
}

pub(crate) fn email_array_arg(args: &Value, key: &str) -> Vec<String> {
    args.get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .take(50)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn optional_email_arg(args: &Value, key: &str) -> Result<Option<String>, String> {
    let value = arg_string(args, key);
    if value.is_empty() {
        return Ok(None);
    }
    validate_email_address(&value)?;
    Ok(Some(value))
}

pub(crate) fn optional_body_arg(args: &Value, key: &str) -> Option<String> {
    let value = arg_string(args, key);
    (!value.is_empty()).then(|| value.chars().take(200_000).collect())
}

pub(crate) fn validate_email_address(value: &str) -> Result<(), String> {
    if value.contains(['\r', '\n']) || !value.contains('@') {
        return Err(format!("Invalid email address: {value}"));
    }
    Ok(())
}

pub(crate) fn require_email_secret<'a>(
    settings: &'a AiProviderSettings,
    label: &str,
) -> Result<&'a str, String> {
    settings
        .email_secret()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{label} is not configured in Settings."))
}

pub(crate) fn email_http_client(settings: &AiProviderSettings) -> Result<reqwest::Client, String> {
    build_web_client(settings.allow_insecure_tls())
}

pub(crate) async fn send_email_resend(
    settings: &AiProviderSettings,
    request: &EmailToolRequest,
) -> String {
    let api_key = match require_email_secret(settings, "Resend API key") {
        Ok(key) => key,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let client = match email_http_client(settings) {
        Ok(client) => client,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let mut body = json!({
        "from": settings.email_from(),
        "to": request.to,
        "subject": request.subject,
    });
    insert_optional_email_fields(&mut body, request);
    send_email_http_request(
        client
            .post("https://api.resend.com/emails")
            .bearer_auth(api_key)
            .json(&body),
        "Resend",
    )
    .await
}

pub(crate) async fn send_email_sendgrid(
    settings: &AiProviderSettings,
    request: &EmailToolRequest,
) -> String {
    let api_key = match require_email_secret(settings, "SendGrid API key") {
        Ok(key) => key,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let client = match email_http_client(settings) {
        Ok(client) => client,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let mut personalization = json!({
        "to": request.to.iter().map(|email| json!({"email": email})).collect::<Vec<_>>()
    });
    if !request.cc.is_empty() {
        personalization["cc"] = json!(
            request
                .cc
                .iter()
                .map(|email| json!({"email": email}))
                .collect::<Vec<_>>()
        );
    }
    if !request.bcc.is_empty() {
        personalization["bcc"] = json!(
            request
                .bcc
                .iter()
                .map(|email| json!({"email": email}))
                .collect::<Vec<_>>()
        );
    }
    let mut content = Vec::new();
    if let Some(text) = &request.text {
        content.push(json!({"type": "text/plain", "value": text}));
    }
    if let Some(html) = &request.html {
        content.push(json!({"type": "text/html", "value": html}));
    }
    let mut body = json!({
        "personalizations": [personalization],
        "from": {"email": settings.email_from()},
        "subject": request.subject,
        "content": content,
    });
    if let Some(reply_to) = &request.reply_to {
        body["reply_to"] = json!({"email": reply_to});
    }
    send_email_http_request(
        client
            .post("https://api.sendgrid.com/v3/mail/send")
            .bearer_auth(api_key)
            .json(&body),
        "SendGrid",
    )
    .await
}

pub(crate) async fn send_email_mailgun(
    settings: &AiProviderSettings,
    request: &EmailToolRequest,
) -> String {
    let api_key = match require_email_secret(settings, "Mailgun API key") {
        Ok(key) => key,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let domain = settings.mailgun_domain();
    if domain.is_empty() {
        return json!({"ok": false, "error": "Mailgun domain is not configured in Settings."})
            .to_string();
    }
    let client = match email_http_client(settings) {
        Ok(client) => client,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let mut form = vec![
        ("from", settings.email_from().to_string()),
        ("to", request.to.join(",")),
        ("subject", request.subject.clone()),
    ];
    if !request.cc.is_empty() {
        form.push(("cc", request.cc.join(",")));
    }
    if !request.bcc.is_empty() {
        form.push(("bcc", request.bcc.join(",")));
    }
    if let Some(reply_to) = &request.reply_to {
        form.push(("h:Reply-To", reply_to.clone()));
    }
    if let Some(text) = &request.text {
        form.push(("text", text.clone()));
    }
    if let Some(html) = &request.html {
        form.push(("html", html.clone()));
    }
    let url = format!("https://api.mailgun.net/v3/{domain}/messages");
    send_email_http_request(
        client
            .post(url)
            .basic_auth("api", Some(api_key))
            .form(&form),
        "Mailgun",
    )
    .await
}

pub(crate) async fn send_email_postmark(
    settings: &AiProviderSettings,
    request: &EmailToolRequest,
) -> String {
    let api_key = match require_email_secret(settings, "Postmark server token") {
        Ok(key) => key,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let client = match email_http_client(settings) {
        Ok(client) => client,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let mut body = json!({
        "From": settings.email_from(),
        "To": request.to.join(","),
        "Subject": request.subject,
    });
    if !request.cc.is_empty() {
        body["Cc"] = json!(request.cc.join(","));
    }
    if !request.bcc.is_empty() {
        body["Bcc"] = json!(request.bcc.join(","));
    }
    if let Some(reply_to) = &request.reply_to {
        body["ReplyTo"] = json!(reply_to);
    }
    if let Some(text) = &request.text {
        body["TextBody"] = json!(text);
    }
    if let Some(html) = &request.html {
        body["HtmlBody"] = json!(html);
    }
    send_email_http_request(
        client
            .post("https://api.postmarkapp.com/email")
            .header("X-Postmark-Server-Token", api_key)
            .header("Accept", "application/json")
            .json(&body),
        "Postmark",
    )
    .await
}

pub(crate) fn insert_optional_email_fields(body: &mut Value, request: &EmailToolRequest) {
    if !request.cc.is_empty() {
        body["cc"] = json!(request.cc);
    }
    if !request.bcc.is_empty() {
        body["bcc"] = json!(request.bcc);
    }
    if let Some(reply_to) = &request.reply_to {
        body["reply_to"] = json!(reply_to);
    }
    if let Some(text) = &request.text {
        body["text"] = json!(text);
    }
    if let Some(html) = &request.html {
        body["html"] = json!(html);
    }
}

pub(crate) async fn send_email_http_request(
    builder: reqwest::RequestBuilder,
    provider: &str,
) -> String {
    match builder.send().await {
        Ok(response) => {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            if status.is_success() {
                json!({"ok": true, "provider": provider, "status": status.as_u16()}).to_string()
            } else {
                json!({
                    "ok": false,
                    "provider": provider,
                    "status": status.as_u16(),
                    "error": truncate_error_body(&text)
                })
                .to_string()
            }
        }
        Err(error) => {
            json!({"ok": false, "provider": provider, "error": format!("Email request failed: {error}")})
                .to_string()
        }
    }
}

pub(crate) fn send_email_smtp(settings: &AiProviderSettings, request: &EmailToolRequest) -> String {
    if settings.smtp_host().is_empty() {
        return json!({"ok": false, "error": "SMTP host is not configured in Settings."})
            .to_string();
    }
    let message = match build_smtp_message(settings.email_from(), request) {
        Ok(message) => message,
        Err(error) => return json!({"ok": false, "error": error}).to_string(),
    };
    let mut builder = if settings.smtp_security() == "none" {
        SmtpTransport::builder_dangerous(settings.smtp_host())
    } else {
        match SmtpTransport::starttls_relay(settings.smtp_host()) {
            Ok(builder) => builder,
            Err(error) => {
                return json!({"ok": false, "error": format!("Invalid SMTP host: {error}")})
                    .to_string();
            }
        }
    }
    .port(settings.smtp_port().into());
    if !settings.smtp_username().is_empty() {
        let password = match require_email_secret(settings, "SMTP password") {
            Ok(password) => password,
            Err(error) => return json!({"ok": false, "error": error}).to_string(),
        };
        builder = builder.credentials(Credentials::new(
            settings.smtp_username().to_string(),
            password.to_string(),
        ));
    }
    let mailer = builder.build();
    match mailer.send(&message) {
        Ok(response) => json!({
            "ok": true,
            "provider": "SMTP",
            "message": response.message().collect::<Vec<_>>().join(" ")
        })
        .to_string(),
        Err(error) => {
            json!({"ok": false, "provider": "SMTP", "error": error.to_string()}).to_string()
        }
    }
}

pub(crate) fn build_smtp_message(
    from: &str,
    request: &EmailToolRequest,
) -> Result<Message, String> {
    let mut builder = Message::builder()
        .from(parse_mailbox(from)?)
        .subject(&request.subject);
    for recipient in &request.to {
        builder = builder.to(parse_mailbox(recipient)?);
    }
    for recipient in &request.cc {
        builder = builder.cc(parse_mailbox(recipient)?);
    }
    for recipient in &request.bcc {
        builder = builder.bcc(parse_mailbox(recipient)?);
    }
    if let Some(reply_to) = &request.reply_to {
        builder = builder.reply_to(parse_mailbox(reply_to)?);
    }
    match (&request.text, &request.html) {
        (Some(text), Some(html)) => builder
            .multipart(MultiPart::alternative_plain_html(
                text.clone(),
                html.clone(),
            ))
            .map_err(|error| format!("Failed to build SMTP message: {error}")),
        (Some(text), None) => builder
            .singlepart(SinglePart::plain(text.clone()))
            .map_err(|error| format!("Failed to build SMTP message: {error}")),
        (None, Some(html)) => builder
            .singlepart(SinglePart::html(html.clone()))
            .map_err(|error| format!("Failed to build SMTP message: {error}")),
        (None, None) => Err("send_email requires text or html body.".to_string()),
    }
}

pub(crate) fn parse_mailbox(value: &str) -> Result<Mailbox, String> {
    value
        .parse::<Mailbox>()
        .map_err(|error| format!("Invalid email address {value}: {error}"))
}
