#[allow(unused_imports)]
use super::*;

pub(crate) fn strip_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len().min(8192));
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
}

pub(crate) fn url_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            b' ' => "+".to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

pub(crate) fn clean_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut prev_was_whitespace = true;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !prev_was_whitespace {
                result.push(' ');
            }
            prev_was_whitespace = true;
        } else {
            result.push(ch);
            prev_was_whitespace = false;
        }
    }
    result.trim().to_string()
}

pub(crate) fn extract_readable_text(html: &str) -> String {
    let document = Html::parse_document(html);

    for selector_str in [
        "article",
        "main",
        "[role=\"main\"]",
        ".post-content",
        ".article-content",
        ".entry-content",
        "#content",
    ] {
        if let Ok(selector) = Selector::parse(selector_str) {
            let combined: String = document
                .select(&selector)
                .flat_map(|el| el.text())
                .collect::<Vec<_>>()
                .join(" ");
            let cleaned = clean_text(&combined);
            if cleaned.len() > 200 {
                return cleaned.chars().take(8000).collect();
            }
        }
    }

    if let Ok(selector) = Selector::parse("body") {
        if let Some(body) = document.select(&selector).next() {
            let combined: String = body.text().collect::<Vec<_>>().join(" ");
            return clean_text(&combined).chars().take(8000).collect();
        }
    }

    clean_text(&strip_html(html)).chars().take(8000).collect()
}

pub(crate) fn build_web_client(allow_insecure_tls: bool) -> Result<reqwest::Client, String> {
    crate::net::proxy::apply_async(reqwest::Client::builder())
        .danger_accept_invalid_certs(allow_insecure_tls)
        .build()
        .map_err(|e| format!("failed to create HTTP client: {e}"))
}

const EXA_MCP_URL: &str = "https://mcp.exa.ai/mcp?tools=web_search_exa";

fn mcp_text_content(content: &Value) -> String {
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            (item.get("type").and_then(Value::as_str) == Some("text"))
                .then(|| item.get("text").and_then(Value::as_str))
                .flatten()
        })
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) async fn web_search_exa(
    query: &str,
    api_key: Option<&str>,
    allow_insecure_tls: bool,
) -> String {
    let result = crate::mcp::call_ephemeral_http_tool(
        EXA_MCP_URL,
        "Exa",
        Some("x-api-key"),
        api_key,
        "web_search_exa",
        json!({
            "query": query,
            "numResults": 5,
        }),
        allow_insecure_tls,
    )
    .await;

    match result {
        Ok(result) => {
            let text = mcp_text_content(&result.content);
            if result.is_error {
                if text.is_empty() {
                    "Exa Search returned an error.".to_string()
                } else {
                    format!("Exa Search returned an error: {text}")
                }
            } else if text.is_empty() {
                "Exa Search returned no results.".to_string()
            } else {
                text.chars().take(6000).collect()
            }
        }
        Err(error) => format!("Exa Search request failed: {error:?}"),
    }
}

pub(crate) async fn web_search_scraper(query: &str, allow_insecure_tls: bool) -> String {
    let client = match build_web_client(allow_insecure_tls) {
        Ok(c) => c,
        Err(e) => return e,
    };

    let json_url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        url_encode(query)
    );

    match client.get(&json_url).send().await {
        Ok(response) => match response.json::<DdgInstantAnswer>().await {
            Ok(answer) => {
                let mut result = String::new();
                if !answer.abstract_text.is_empty() {
                    result.push_str("Instant answer: ");
                    result.push_str(&answer.abstract_text);
                    if !answer.abstract_url.is_empty() {
                        result.push_str(&format!("\nSource: {}", answer.abstract_url));
                    }
                }
                let mut has_related = false;
                for topic in &answer.related_topics {
                    if let Some(text) = &topic.text {
                        if !has_related {
                            if !result.is_empty() {
                                result.push_str("\n\n");
                            }
                            result.push_str("Related topics:\n");
                            has_related = true;
                        }
                        result.push_str(&format!("- {}\n", text));
                    }
                }
                if !result.is_empty() {
                    return result.chars().take(4000).collect();
                }
            }
            Err(_) => {}
        },
        Err(_) => {}
    }

    let html_url = format!("https://html.duckduckgo.com/html/?q={}", url_encode(query));
    match client.get(&html_url).send().await {
        Ok(response) => match response.text().await {
            Ok(html) => {
                let document = Html::parse_document(&html);
                let mut result = String::new();
                if let Ok(sel) = Selector::parse(".result__body") {
                    for (i, el) in document.select(&sel).enumerate() {
                        if i >= 6 {
                            break;
                        }
                        let snippet: String = el.text().collect::<Vec<_>>().join(" ");
                        let cleaned = clean_text(&snippet);
                        if !cleaned.is_empty() {
                            result.push_str(&cleaned);
                            result.push('\n');
                        }
                    }
                }
                if result.is_empty() {
                    clean_text(&strip_html(&html)).chars().take(4000).collect()
                } else {
                    result.chars().take(4000).collect()
                }
            }
            Err(error) => format!("Web search failed: {error}"),
        },
        Err(error) => format!("Web search failed: {error}"),
    }
}

pub(crate) async fn web_search_brave(
    query: &str,
    api_key: &str,
    allow_insecure_tls: bool,
) -> String {
    let client = match build_web_client(allow_insecure_tls) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let url = format!(
        "https://api.search.brave.com/res/v1/web/search?q={}&count=5",
        url_encode(query)
    );
    match client
        .get(&url)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "gzip")
        .header("X-Subscription-Token", api_key)
        .send()
        .await
    {
        Ok(response) => match response.json::<BraveSearchResponse>().await {
            Ok(data) => {
                if let Some(web) = data.web {
                    let mut result = String::new();
                    for (i, r) in web.results.iter().enumerate() {
                        result.push_str(&format!("{}. {}\n", i + 1, r.title));
                        result.push_str(&format!("   {}\n", r.url));
                        result.push_str(&format!("   {}\n", r.description));
                    }
                    result.chars().take(4000).collect()
                } else {
                    "Brave Search returned no web results.".to_string()
                }
            }
            Err(error) => format!("Failed to parse Brave Search response: {error}"),
        },
        Err(error) => format!("Brave Search request failed: {error}"),
    }
}

pub(crate) async fn web_search_tavily(
    query: &str,
    api_key: &str,
    allow_insecure_tls: bool,
) -> String {
    let client = match build_web_client(allow_insecure_tls) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let body = serde_json::json!({
        "api_key": api_key,
        "query": query,
        "search_depth": "basic",
        "include_answer": true,
        "max_results": 5,
    });
    match client
        .post("https://api.tavily.com/search")
        .json(&body)
        .send()
        .await
    {
        Ok(response) => match response.json::<TavilySearchResponse>().await {
            Ok(data) => {
                let mut result = String::new();
                if let Some(answer) = &data.answer {
                    if !answer.is_empty() {
                        result.push_str("Answer: ");
                        result.push_str(answer);
                        result.push_str("\n\n");
                    }
                }
                for (i, r) in data.results.iter().enumerate() {
                    result.push_str(&format!("{}. {}\n", i + 1, r.title));
                    result.push_str(&format!("   {}\n", r.url));
                    result.push_str(&format!("   {}\n", r.content));
                }
                result.chars().take(4000).collect()
            }
            Err(error) => format!("Failed to parse Tavily response: {error}"),
        },
        Err(error) => format!("Tavily request failed: {error}"),
    }
}

pub(crate) async fn web_search_searxng(
    query: &str,
    instance_url: &str,
    allow_insecure_tls: bool,
) -> String {
    let client = match build_web_client(allow_insecure_tls) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let base = instance_url.trim_end_matches('/');
    let url = format!("{}/search?q={}&format=json", base, url_encode(query));
    match client.get(&url).send().await {
        Ok(response) => match response.json::<SearxngSearchResponse>().await {
            Ok(data) => {
                let mut result = String::new();
                for (i, r) in data.results.iter().enumerate().take(6) {
                    result.push_str(&format!("{}. {}\n", i + 1, r.title));
                    result.push_str(&format!("   {}\n", r.url));
                    if let Some(content) = &r.content {
                        result.push_str(&format!("   {}\n", content));
                    }
                }
                if result.is_empty() {
                    "SearXNG returned no results.".to_string()
                } else {
                    result.chars().take(4000).collect()
                }
            }
            Err(error) => format!("Failed to parse SearXNG response: {error}"),
        },
        Err(error) => format!("SearXNG request failed: {error}"),
    }
}

#[derive(Deserialize)]
pub(crate) struct DdgInstantAnswer {
    #[serde(rename = "AbstractText")]
    abstract_text: String,
    #[serde(rename = "AbstractURL")]
    abstract_url: String,
    #[serde(rename = "RelatedTopics")]
    related_topics: Vec<DdgRelatedTopic>,
}

#[derive(Deserialize)]
pub(crate) struct DdgRelatedTopic {
    #[serde(rename = "Text")]
    text: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct BraveSearchResponse {
    web: Option<BraveWeb>,
}

#[derive(Deserialize)]
pub(crate) struct BraveWeb {
    results: Vec<BraveResult>,
}

#[derive(Deserialize)]
pub(crate) struct BraveResult {
    title: String,
    url: String,
    description: String,
}

#[derive(Deserialize)]
pub(crate) struct TavilySearchResponse {
    answer: Option<String>,
    results: Vec<TavilyResult>,
}

#[derive(Deserialize)]
pub(crate) struct TavilyResult {
    title: String,
    url: String,
    content: String,
}

#[derive(Deserialize)]
pub(crate) struct SearxngSearchResponse {
    results: Vec<SearxngResult>,
}

#[derive(Deserialize)]
pub(crate) struct SearxngResult {
    title: String,
    url: String,
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::mcp_text_content;
    use serde_json::json;

    #[test]
    fn exa_mcp_text_content_joins_text_blocks_and_ignores_other_content() {
        let content = json!([
            {"type": "text", "text": "First result"},
            {"type": "image", "data": "ignored"},
            {"type": "text", "text": "  Second result  "}
        ]);

        assert_eq!(mcp_text_content(&content), "First result\n\nSecond result");
    }
}
