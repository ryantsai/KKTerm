// Provider adapters live in one file per provider; Rust still requires this explicit module registry.
mod azure_openai;
mod deepseek;
mod gemini;
mod grok;
mod litellm;
mod moonshot;
mod nvidia;
mod ollama;
mod ollama_cloud;
mod openai;
mod openai_compatible;
mod opencode;
mod openrouter;
mod zai;

use super::{AgentProviderAdapter, GitHubCopilotProvider};

pub(super) fn provider_for(kind: &str) -> Result<AgentProviderAdapter, String> {
    match kind {
        "azure-openai" => Ok(AgentProviderAdapter::OpenAi(azure_openai::provider())),
        "deepseek" => Ok(AgentProviderAdapter::OpenAi(deepseek::provider())),
        "gemini" => Ok(AgentProviderAdapter::OpenAi(gemini::provider())),
        "grok" => Ok(AgentProviderAdapter::OpenAi(grok::provider())),
        "litellm" => Ok(AgentProviderAdapter::OpenAi(litellm::provider())),
        "moonshot" => Ok(AgentProviderAdapter::OpenAi(moonshot::provider())),
        "openai" => Ok(AgentProviderAdapter::OpenAi(openai::provider())),
        "openrouter" => Ok(AgentProviderAdapter::OpenAi(openrouter::provider())),
        "zai" => Ok(AgentProviderAdapter::OpenAi(zai::provider())),
        "ollama" => Ok(AgentProviderAdapter::OpenAi(ollama::provider())),
        "ollama-cloud" => Ok(AgentProviderAdapter::OpenAi(ollama_cloud::provider())),
        "nvidia" => Ok(AgentProviderAdapter::OpenAi(nvidia::provider())),
        "opencode" => Ok(AgentProviderAdapter::OpenAi(opencode::provider())),
        "openai-compatible" => Ok(AgentProviderAdapter::OpenAi(openai_compatible::provider())),
        "anthropic" => Err(
            "Anthropic support needs a provider adapter; DeepSeek and OpenAI-compatible providers are wired first."
                .to_string(),
        ),
        "cursor" => Err(
            "Cursor Agent CLI must be enabled in Settings to use the Cursor provider.".to_string(),
        ),
        "github-copilot" => Ok(AgentProviderAdapter::GitHubCopilot(GitHubCopilotProvider)),
        _ => Err("AI provider is not supported by the agent runner".to_string()),
    }
}
