#[allow(unused_imports)]
use super::*;

pub(crate) const DEFAULT_MAX_AGENT_TOOL_SUBTURNS: usize = 10;
pub(crate) const ITOPS_MAX_AGENT_TOOL_SUBTURNS: usize = 32;
pub(crate) const TOOL_SUBTURN_LIMIT_NOTICE: &str = "The tool-call safety limit was reached. Do not output tool-call JSON, function names, or arguments as a substitute for executing tools. Briefly summarize what was completed, clearly say that the requested work is incomplete, and ask the user to continue in a new message.";

impl OpenAiCompatibleProvider {
    pub(crate) fn api_style_for_settings(&self, api_mode: &str) -> OpenAiApiStyle {
        if self.provider_kind != "openai-compatible" {
            return self.default_api;
        }
        match api_mode {
            "responses" => OpenAiApiStyle::Responses,
            _ => OpenAiApiStyle::ChatCompletions,
        }
    }

    fn supports_explicit_strict_tool_schemas(&self) -> bool {
        matches!(self.provider_kind, "openai" | "azure-openai")
    }

    pub(crate) fn tool_definitions_for_provider(
        &self,
        tools: &[OpenAiToolDefinition],
    ) -> Vec<OpenAiToolDefinition> {
        let mut tools = tools.to_vec();
        if !self.supports_explicit_strict_tool_schemas() {
            for tool in &mut tools {
                tool.function.strict = false;
            }
        }
        tools
    }

    fn responses_tool_definitions_for_provider(
        &self,
        tools: &[OpenAiToolDefinition],
    ) -> Vec<Value> {
        let tools = self.tool_definitions_for_provider(tools);
        responses_tool_definitions(&tools)
    }

    /// Shared agent orchestration for both OpenAI API styles, streaming and
    /// non-streaming: sub-turn cap, tool execution with approval flow,
    /// consecutive-tool-error abort, user cancellation, stream events, and
    /// the final forced answer once the cap is reached. This loop previously
    /// existed as four hand-kept copies that had already drifted — the
    /// non-streaming copies lacked the consecutive-error abort entirely.
    pub(crate) async fn run_agent_loop(
        &self,
        app: tauri::AppHandle,
        settings: AiProviderSettings,
        api_key: Option<String>,
        request: AgentRunRequest,
        channel: Option<Channel<Value>>,
        api_style: OpenAiApiStyle,
    ) -> Result<AgentRunResponse, String> {
        let prompt = trim_required("assistant prompt", request.prompt)?;
        let allowed_tools = request.allowed_tools.clone();
        let context_label = trim_required("assistant context", request.context_label)?;
        let active_connection_scope =
            active_connection_memory_scope(request.active_connection_id.as_deref());
        let recalled_memories = if settings.tools().memory() {
            recall_assistant_memories(&app, active_connection_scope.as_deref())
        } else {
            Vec::new()
        };
        let skill_summaries = enabled_skill_summaries_for_request(
            &app,
            settings.disabled_skill_names(),
            settings.custom_skills_enabled(),
        )?;
        let supports_images = supports_image_input(self.provider_kind, settings.model());
        let sent_screenshot_count =
            request.screenshots.len() + usize::from(request.screenshot.is_some());
        let attachment_chars = estimate_attachment_context_chars(
            supports_images,
            sent_screenshot_count,
            &request.files,
            api_style == OpenAiApiStyle::Responses,
        );
        let isolated_host_ai = request.isolated_host_ai;
        let built_messages = build_agent_messages_for_provider_with_usage(
            self.provider_kind,
            settings.model(),
            prompt,
            context_label,
            request.intent,
            settings.reasoning_effort().to_string(),
            request.system_context,
            request.selected_output,
            request.page_context,
            supports_images,
            request.screenshot,
            request.screenshots,
            request.messages,
            request.output_language,
            Some(settings.custom_instructions().to_string()),
            skill_summaries.clone(),
            settings.tools().dashboard(),
            recalled_memories,
            attachment_chars,
            isolated_host_ai,
        );
        if let Some(channel) = channel.as_ref() {
            emit_stream(
                channel,
                &AiStreamEvent::ContextUsage {
                    usage: built_messages.usage.clone(),
                },
            )?;
        }
        let tool_definitions = agent_tool_definitions(
            request.allow_tools,
            &allowed_tools,
            settings.tools(),
            &skill_summaries,
        );
        let mut transport = match api_style {
            OpenAiApiStyle::ChatCompletions => AgentTransport::Chat {
                endpoint: chat_completions_endpoint(
                    settings.base_url(),
                    settings.model(),
                    self.endpoint_style,
                )?,
                messages: built_messages.messages,
                tools: self.tool_definitions_for_provider(&tool_definitions),
            },
            OpenAiApiStyle::Responses => AgentTransport::Responses {
                endpoint: responses_endpoint(settings.base_url(), self.endpoint_style)?,
                input: responses_input_from_messages(built_messages.messages, request.files),
                tools: self.responses_tool_definitions_for_provider(&tool_definitions),
            },
        };
        let client = ai_http_client(settings.allow_insecure_tls())?;
        let app_data_dir = crate::app_paths::data_dir(&app)?;
        let model = settings.model().to_string();
        let max_tool_subturns = if settings.tools().itops() {
            ITOPS_MAX_AGENT_TOOL_SUBTURNS
        } else {
            DEFAULT_MAX_AGENT_TOOL_SUBTURNS
        };
        let mut tool_error_tracker = ConsecutiveToolErrorTracker::default();
        // Cancellation is scoped to interactive (streaming) runs. Unattended
        // non-streaming runs — watchdog intervention sub-turns — must not be
        // killed by the user pressing Stop on an unrelated chat.
        let cancel_generation = channel.as_ref().map(|_| assistant_stream_generation(&app));
        let run_canceled = |app: &tauri::AppHandle| {
            cancel_generation.is_some_and(|generation| assistant_stream_canceled(app, generation))
        };

        for turn_index in 0..max_tool_subturns {
            if run_canceled(&app) {
                return Err(ASSISTANT_STREAM_CANCELED_ERROR.to_string());
            }
            ai_debug!(
                "agent turn provider={} model={} subturn={} streaming={}",
                self.provider_kind,
                model,
                turn_index + 1,
                channel.is_some()
            );
            let turn = transport
                .run_turn(
                    self,
                    &client,
                    &settings,
                    api_key.as_deref(),
                    channel.as_ref(),
                    turn_index + 1,
                    true,
                )
                .await?;
            ai_debug!(
                "agent turn reply provider={} model={} subturn={} content_len={} tool_calls={}",
                self.provider_kind,
                model,
                turn_index + 1,
                turn.content.len(),
                turn.tool_calls.len()
            );
            if turn.tool_calls.is_empty() {
                return self.finish_turn(&model, turn, channel.as_ref(), true);
            }
            transport.append_model_turn(&turn);
            for tool_call in &turn.tool_calls {
                // Stop before executing the next tool, not just the next
                // provider call: a canceled run must not keep mutating state.
                if run_canceled(&app) {
                    return Err(ASSISTANT_STREAM_CANCELED_ERROR.to_string());
                }
                let is_skill_tool = is_silent_assistant_tool(&tool_call.function.name);
                if let Some(channel) = channel.as_ref() {
                    if !is_skill_tool {
                        emit_stream(
                            channel,
                            &AiStreamEvent::ToolCallStart {
                                tool_id: tool_call.id.clone(),
                                tool_name: tool_call.function.name.clone(),
                            },
                        )?;
                    }
                }
                ai_debug!(
                    "tool start provider={} model={} subturn={} id={} name={} args_len={}",
                    self.provider_kind,
                    model,
                    turn_index + 1,
                    tool_call.id,
                    tool_call.function.name,
                    tool_call.function.arguments.len()
                );
                let result = run_ai_tool(
                    &settings,
                    &app_data_dir,
                    &app,
                    tool_call,
                    channel.as_ref(),
                    &allowed_tools,
                    active_connection_scope.as_deref(),
                )
                .await;
                ai_debug!(
                    "tool end provider={} model={} subturn={} id={} name={} result_len={}",
                    self.provider_kind,
                    model,
                    turn_index + 1,
                    tool_call.id,
                    tool_call.function.name,
                    result.len()
                );
                let tool_error = tool_result_error(&result);
                let abort_message = tool_error_tracker.note(&tool_call.function.name, &tool_error);
                transport.append_tool_result(tool_call, result);
                if let Some(channel) = channel.as_ref() {
                    if !is_skill_tool {
                        emit_stream(
                            channel,
                            &AiStreamEvent::ToolCallEnd {
                                tool_id: tool_call.id.clone(),
                                tool_name: tool_call.function.name.clone(),
                                error: tool_error,
                            },
                        )?;
                    }
                }
                if let Some(message) = abort_message {
                    let turn = AgentTurnOutput {
                        content: message,
                        reasoning: None,
                        tool_calls: vec![],
                        raw_response_output: None,
                    };
                    return self.finish_turn(&model, turn, channel.as_ref(), false);
                }
            }
        }

        // Sub-turn cap reached: ask for one final answer with tools withheld
        // so the model must reply instead of looping. Make the incomplete state
        // explicit so it does not print planned tool-call JSON as if it ran.
        ai_debug!(
            "agent loop exhausted provider={} model={} streaming={}",
            self.provider_kind,
            model,
            channel.is_some()
        );
        transport.append_tool_subturn_limit_notice();
        let turn = transport
            .run_turn(
                self,
                &client,
                &settings,
                api_key.as_deref(),
                channel.as_ref(),
                max_tool_subturns + 1,
                false,
            )
            .await?;
        self.finish_turn(&model, turn, channel.as_ref(), true)
    }

    /// Common run completion: the streamed-content requirement (skipped for
    /// the consecutive-error abort message, which was never streamed), the
    /// Done stream event, and the provider-labelled response envelope.
    fn finish_turn(
        &self,
        model: &str,
        turn: AgentTurnOutput,
        channel: Option<&Channel<Value>>,
        require_content: bool,
    ) -> Result<AgentRunResponse, String> {
        if let Some(channel) = channel {
            if require_content {
                require_streamed_assistant_content(self, &turn.content)?;
            }
            emit_stream(
                channel,
                &AiStreamEvent::Done {
                    model: model.to_string(),
                    provider_kind: self.provider_kind.to_string(),
                },
            )?;
        }
        finish_agent_response(self, model, turn.content, turn.reasoning)
    }
}

/// One model turn's parsed output, independent of API style and transport.
pub(crate) struct AgentTurnOutput {
    pub(crate) content: String,
    pub(crate) reasoning: Option<String>,
    pub(crate) tool_calls: Vec<OpenAiToolCall>,
    /// Raw `output` items from a non-streaming Responses turn. Replayed
    /// verbatim into the next request so provider-side items (reasoning,
    /// message ids) survive exactly as returned.
    pub(crate) raw_response_output: Option<Vec<Value>>,
}

/// API-style-specific transcript state plus request building and reply
/// parsing for one agent run. All orchestration lives in `run_agent_loop`.
pub(crate) enum AgentTransport {
    Chat {
        endpoint: String,
        messages: Vec<OpenAiCompatibleMessage>,
        tools: Vec<OpenAiToolDefinition>,
    },
    Responses {
        endpoint: String,
        input: Vec<Value>,
        tools: Vec<Value>,
    },
}

impl AgentTransport {
    fn api_name(&self, streaming: bool) -> &'static str {
        match (self, streaming) {
            (AgentTransport::Chat { .. }, false) => "chat_completions",
            (AgentTransport::Chat { .. }, true) => "chat_completions_stream",
            (AgentTransport::Responses { .. }, false) => "responses",
            (AgentTransport::Responses { .. }, true) => "responses_stream",
        }
    }

    /// Send one model turn and parse the reply, streaming through `channel`
    /// when present. `with_tools=false` is the final forced-answer turn after
    /// the sub-turn cap.
    async fn run_turn(
        &self,
        provider: &OpenAiCompatibleProvider,
        client: &reqwest::Client,
        settings: &AiProviderSettings,
        api_key: Option<&str>,
        channel: Option<&Channel<Value>>,
        turn_number: usize,
        with_tools: bool,
    ) -> Result<AgentTurnOutput, String> {
        let api = self.api_name(channel.is_some());
        let model = settings.model();
        let response = match self {
            AgentTransport::Chat {
                endpoint,
                messages,
                tools,
            } => {
                let request_body = OpenAiCompatibleChatRequest {
                    model: model.to_string(),
                    messages: messages.clone(),
                    stream: channel.is_some(),
                    tools: if with_tools { tools.clone() } else { vec![] },
                    tool_choice: (with_tools && !tools.is_empty()).then(|| "auto".to_string()),
                    thinking: deepseek_thinking(
                        provider.provider_kind,
                        settings.reasoning_effort(),
                    ),
                };
                log_provider_request(
                    api,
                    provider.provider_kind,
                    model,
                    turn_number,
                    endpoint,
                    &request_body,
                );
                client
                    .post(endpoint.clone())
                    .headers(openai_compatible_headers(
                        api_key,
                        provider.auth_style,
                        extra_headers_for_provider(provider.provider_kind, settings),
                    )?)
                    .json(&request_body)
                    .send()
                    .await
                    .map_err(|error| format!("failed to reach {}: {error}", provider.label))?
            }
            AgentTransport::Responses {
                endpoint,
                input,
                tools,
            } => {
                let request_body = OpenAiResponsesRequest {
                    model: model.to_string(),
                    input: input.clone(),
                    stream: channel.is_some(),
                    store: false,
                    reasoning: openai_responses_reasoning(
                        provider.provider_kind,
                        model,
                        settings.reasoning_effort(),
                    ),
                    tools: if with_tools { tools.clone() } else { vec![] },
                    tool_choice: (with_tools && !tools.is_empty()).then(|| "auto".to_string()),
                };
                log_provider_request(
                    api,
                    provider.provider_kind,
                    model,
                    turn_number,
                    endpoint,
                    &request_body,
                );
                client
                    .post(endpoint.clone())
                    .headers(openai_compatible_headers(
                        api_key,
                        provider.auth_style,
                        extra_headers_for_provider(provider.provider_kind, settings),
                    )?)
                    .json(&request_body)
                    .send()
                    .await
                    .map_err(|error| format!("failed to reach {}: {error}", provider.label))?
            }
        };

        let status = response.status();
        if let Some(channel) = channel {
            // Streaming: the body can only be read once, so error text is
            // fetched (and logged) only on failure.
            if !status.is_success() {
                let response_text = response.text().await.map_err(|error| {
                    format!("failed to read {} response: {error}", provider.label)
                })?;
                log_provider_response(
                    api,
                    provider.provider_kind,
                    model,
                    turn_number,
                    status.as_u16(),
                    &response_text,
                );
                return Err(format!(
                    "{} returned HTTP {}: {}",
                    provider.label,
                    status.as_u16(),
                    truncate_error_body(&response_text)
                ));
            }
            match self {
                AgentTransport::Chat { .. } => {
                    let (content, tool_calls, reasoning) =
                        stream_chat_completions(response, channel).await?;
                    Ok(AgentTurnOutput {
                        content,
                        reasoning,
                        tool_calls,
                        raw_response_output: None,
                    })
                }
                AgentTransport::Responses { .. } => {
                    let (content, tool_calls, reasoning) =
                        stream_responses_completions(response, channel).await?;
                    Ok(AgentTurnOutput {
                        content: content.unwrap_or_default(),
                        reasoning,
                        tool_calls,
                        raw_response_output: None,
                    })
                }
            }
        } else {
            let response_text = response
                .text()
                .await
                .map_err(|error| format!("failed to read {} response: {error}", provider.label))?;
            log_provider_response(
                api,
                provider.provider_kind,
                model,
                turn_number,
                status.as_u16(),
                &response_text,
            );
            if !status.is_success() {
                return Err(format!(
                    "{} returned HTTP {}: {}",
                    provider.label,
                    status.as_u16(),
                    truncate_error_body(&response_text)
                ));
            }
            match self {
                AgentTransport::Chat { .. } => {
                    let completion: OpenAiCompatibleChatResponse =
                        serde_json::from_str(&response_text).map_err(|error| {
                            format!("failed to parse {} response: {error}", provider.label)
                        })?;
                    let Some(choice) = completion.choices.into_iter().next() else {
                        return Err(format!(
                            "{} response did not include a choice",
                            provider.label
                        ));
                    };
                    Ok(AgentTurnOutput {
                        content: choice.message.content.trim().to_string(),
                        reasoning: chat_response_reasoning(&choice.message),
                        tool_calls: choice.message.tool_calls,
                        raw_response_output: None,
                    })
                }
                AgentTransport::Responses { .. } => {
                    let response_value: Value =
                        serde_json::from_str(&response_text).map_err(|error| {
                            format!("failed to parse {} response: {error}", provider.label)
                        })?;
                    let content = response_value
                        .get("output_text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .or_else(|| extract_responses_output_text(&response_value))
                        .unwrap_or_default();
                    Ok(AgentTurnOutput {
                        content,
                        reasoning: extract_responses_reasoning_text(&response_value),
                        tool_calls: extract_responses_tool_calls(&response_value),
                        raw_response_output: response_value
                            .get("output")
                            .and_then(Value::as_array)
                            .cloned(),
                    })
                }
            }
        }
    }

    /// Record the model's tool-calling turn in the transcript before the tool
    /// results are appended. Only called when the turn carried tool calls.
    pub(crate) fn append_model_turn(&mut self, turn: &AgentTurnOutput) {
        match self {
            AgentTransport::Chat { messages, .. } => messages.push(OpenAiCompatibleMessage {
                role: "assistant".to_string(),
                content: OpenAiCompatibleContent::Text(turn.content.clone()),
                reasoning_content: turn.reasoning.clone().filter(|r| !r.trim().is_empty()),
                tool_call_id: None,
                tool_calls: Some(
                    turn.tool_calls
                        .iter()
                        .map(|tool_call| OpenAiAssistantToolCall {
                            id: tool_call.id.clone(),
                            tool_type: "function".to_string(),
                            function: OpenAiAssistantToolCallFunction {
                                name: tool_call.function.name.clone(),
                                arguments: tool_call.function.arguments.clone(),
                            },
                            extra_content: tool_call.extra_content.clone(),
                        })
                        .collect(),
                ),
            }),
            AgentTransport::Responses { input, .. } => {
                if let Some(raw) = &turn.raw_response_output {
                    input.extend(raw.iter().cloned());
                } else {
                    if !turn.content.trim().is_empty() {
                        input.push(json!({
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": turn.content}],
                        }));
                    }
                    for tool_call in &turn.tool_calls {
                        input.push(json!({
                            "type": "function_call",
                            "call_id": tool_call.id,
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments,
                        }));
                    }
                }
            }
        }
    }

    pub(crate) fn append_tool_result(&mut self, tool_call: &OpenAiToolCall, result: String) {
        match self {
            AgentTransport::Chat { messages, .. } => messages.push(OpenAiCompatibleMessage {
                role: "tool".to_string(),
                content: OpenAiCompatibleContent::Text(result),
                reasoning_content: None,
                tool_call_id: Some(tool_call.id.clone()),
                tool_calls: None,
            }),
            AgentTransport::Responses { input, .. } => input.push(json!({
                "type": "function_call_output",
                "call_id": tool_call.id,
                "output": result,
            })),
        }
    }

    fn append_tool_subturn_limit_notice(&mut self) {
        match self {
            AgentTransport::Chat { messages, .. } => messages.push(OpenAiCompatibleMessage {
                role: "user".to_string(),
                content: OpenAiCompatibleContent::Text(TOOL_SUBTURN_LIMIT_NOTICE.to_string()),
                reasoning_content: None,
                tool_call_id: None,
                tool_calls: None,
            }),
            AgentTransport::Responses { input, .. } => input.push(json!({
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": TOOL_SUBTURN_LIMIT_NOTICE}],
            })),
        }
    }
}
