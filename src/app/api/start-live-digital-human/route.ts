import { NextRequest, NextResponse } from "next/server";
import { AgentStore } from "@/lib/store";
import { parseJSON } from "@/lib/json";
import { AdvancedConfig, CallbackConfig, CONSTANTS, DigitalHumanInfo, TTSConfig, ZegoAIAgent } from "@/lib/zego/aiagent";

interface StartLiveDigitalHumanRequest {
  agent_id?: string;
  digital_human_id?: string;
  config_id?: string;
  digital_human?: DigitalHumanInfo;
  room_id?: string;
  cdn_url?: string;
  tts?: TTSConfig;
  callback_config?: CallbackConfig;
  advanced_config?: AdvancedConfig;
  extension_params?: any;
}

interface NativeStartLiveDigitalHumanRequest {
  AgentId?: string;
  DigitalHuman?: DigitalHumanInfo;
  RTC?: LiveDigitalHumanRtcRequest;
  CDN?: {
    Url: string;
  };
  TTS?: TTSConfig;
  CallbackConfig?: CallbackConfig;
  AdvancedConfig?: AdvancedConfig;
  ExtensionParams?: any;
}

interface LiveDigitalHumanRtcRequest {
    RoomId: string;
    AgentStreamId: string;
    AgentUserId: string;
}

interface NormalizedStartLiveDigitalHumanRequest {
  agentId: string;
  digitalHumanConfig: DigitalHumanInfo | null;
  rtcConfig: LiveDigitalHumanRtcRequest | null;
  cdnConfig: { Url: string } | null;
  ttsConfig: TTSConfig | null;
  callbackConfig: CallbackConfig | null;
  advancedConfig: AdvancedConfig | null;
  extensionParams: any;
}

interface LiveDigitalHumanResponse {
  code: number;
  message: string;
  agent_id?: string;
  agent_instance_id?: string;
  digital_human_config?: any;
  request_id?: string;
  agent_stream_id?: string;
  agent_user_id?: string;
}

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(2, 10);
}

function getDigitalHumanConfig(
  body: StartLiveDigitalHumanRequest,
  nativeBody: NativeStartLiveDigitalHumanRequest,
  rtcConfig?: LiveDigitalHumanRtcRequest | null
): DigitalHumanInfo | null {
  if (body.digital_human?.DigitalHumanId && body.digital_human?.ConfigId) {
    return body.digital_human;
  }

  if (nativeBody.DigitalHuman?.DigitalHumanId && nativeBody.DigitalHuman?.ConfigId) {
    return nativeBody.DigitalHuman;
  }

  if (body.digital_human_id && body.config_id) {
    return {
      DigitalHumanId: body.digital_human_id,
      ConfigId: body.config_id,
      DigitalHumanRoomId: rtcConfig?.RoomId,
      DigitalHumanStreamId: rtcConfig?.AgentStreamId,
      DigitalHumanUserId: rtcConfig?.AgentUserId,
      DigitalHumanMaxAliveTime: 200
    };
  }

  return null;
}

function normalizeRequestBody(rawBody: unknown): NormalizedStartLiveDigitalHumanRequest {
  const body = rawBody as StartLiveDigitalHumanRequest;
  const nativeBody = rawBody as NativeStartLiveDigitalHumanRequest;
  const agentStreamId = randomId("stream_agent_");
  const agentUserId = randomId("user_agent_");

  const rtcConfig = nativeBody.RTC || (body.room_id
    ? {
        RoomId: body.room_id,
        AgentStreamId: agentStreamId,
        AgentUserId: agentUserId,
      }
    : null);

  return {
    agentId: body.agent_id || nativeBody.AgentId || CONSTANTS.AGENT_ID,
    digitalHumanConfig: getDigitalHumanConfig(body, nativeBody, rtcConfig),
    rtcConfig,
    cdnConfig: nativeBody.CDN || (body.cdn_url ? { Url: body.cdn_url } : null),
    ttsConfig: body.tts || nativeBody.TTS || null,
    callbackConfig: body.callback_config || nativeBody.CallbackConfig || null,
    advancedConfig: body.advanced_config || nativeBody.AdvancedConfig || (process.env.ADVANCED_CONFIG ? parseJSON(process.env.ADVANCED_CONFIG) : null),
    extensionParams: body.extension_params || nativeBody.ExtensionParams || null,
  };
}

function createErrorResponse(code: number, message: string, status = 200): NextResponse {
  const response: LiveDigitalHumanResponse = { code, message };
  return NextResponse.json(response, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const {
      agentId,
      digitalHumanConfig,
      rtcConfig,
      cdnConfig,
      ttsConfig,
      callbackConfig,
      advancedConfig,
      extensionParams,
    } = normalizeRequestBody(body);

    if (!digitalHumanConfig) {
      return createErrorResponse(
        400,
        "请求参数不完整，缺少必需字段: digital_human_id, config_id 或 digital_human.DigitalHumanId, digital_human.ConfigId",
        400
      );
    }

    if (!rtcConfig && !cdnConfig) {
      return createErrorResponse(
        400,
        "请求参数不完整，RTC 和 CDN 配置二选一，请提供 room_id 或 cdn_url",
        400
      );
    }

    const assistant = ZegoAIAgent.getInstance();
    const store = AgentStore.getInstance();

    await assistant.ensureAgentRegistered(agentId, CONSTANTS.AGENT_NAME);

    const result = await assistant.createLiveDigitalHumanAgentInstance(
      agentId,
      digitalHumanConfig,
      rtcConfig,
      cdnConfig,
      ttsConfig,
      callbackConfig,
      advancedConfig,
      extensionParams
    );

    if (result.Code !== 0) {
      return createErrorResponse(result.Code, result.Message || "创建播报数字人实例失败");
    }

    const agentInstanceId = result.Data.AgentInstanceId;
    store.setAgentInstanceId(agentInstanceId);

    return NextResponse.json(
      {
        code: 0,
        message: "播报数字人智能体启动成功",
        agent_id: agentId,
        agent_instance_id: agentInstanceId,
        digital_human_config: result.Data.DigitalHumanConfig,
        request_id: result.Data.RequestId,
        agent_stream_id: rtcConfig?.AgentStreamId,
        agent_user_id: rtcConfig?.AgentUserId,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("启动播报数字人智能体失败:", error);

    const errorCode = (error as any).code || 500;
    const errorMessage = (error as any).message || "启动播报数字人智能体时发生未知错误";

    return NextResponse.json(
      {
        code: errorCode,
        message: errorMessage,
      },
      { status: errorCode >= 400 && errorCode < 500 ? errorCode : 500 }
    );
  }
}
