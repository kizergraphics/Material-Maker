import type { MaterialEvaluation } from "./material-evaluator";
import type {
  MapGenerationSettings,
  SourceTextureAsset,
  TextureMapChannel,
} from "./material-types";

export type MaterialGenerationWorkerRequest =
  | {
      type: "initialize";
      source: SourceTextureAsset;
    }
  | {
      type: "generate";
      requestId: number;
      maxEdge: number;
      settings: MapGenerationSettings;
      channels: TextureMapChannel[];
    };

export type GeneratedMapsPayload = {
  result: Partial<MaterialEvaluation>;
  width: number;
  height: number;
  full: boolean;
};

export type MaterialGenerationWorkerResponse =
  | ({
      type: "generated";
      requestId: number;
    } & GeneratedMapsPayload)
  | {
      type: "error";
      requestId: number;
      message: string;
    };
