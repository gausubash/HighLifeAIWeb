import { describe, expect, it } from "vitest";
import type { MlModel } from "./types";
import { studioBakeBundle } from "./exportBakeBundle";

describe("studioBakeBundle", () => {
  it("emits a studio: token and specialist role", () => {
    const model: MlModel = {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      dataset_id: null,
      training_job_id: null,
      name: "rooms-ft",
      task: "segment",
      architecture: "yolo",
      category: "room_types",
      storage_path: "models/x.pt",
      class_names: ["Bedroom"],
      metrics: { "metrics/mAP50": 0.7 },
      is_active: true,
      created_at: "",
    };
    const bake = studioBakeBundle(model);
    expect(bake.model.detectToken).toBe("studio:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(bake.specialist?.role).toBe("units_rooms");
  });
});
