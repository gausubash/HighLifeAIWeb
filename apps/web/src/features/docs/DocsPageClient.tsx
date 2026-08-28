"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { LABELME_CLASSES } from "@/features/plan-editor/labelClasses";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "pipeline", label: "Detection pipeline" },
  { id: "models", label: "Model catalog" },
  { id: "tiling", label: "Tiling mathematics" },
  { id: "nms", label: "Tile merge (NMM)" },
  { id: "masks", label: "Masks → polygons" },
  { id: "coords", label: "Coordinate systems" },
  { id: "training", label: "Training & losses" },
  { id: "params", label: "Parameter reference" },
  { id: "labels", label: "Label classes" },
  { id: "overlaps", label: "Overlapping regions" },
  { id: "hierarchy", label: "Building hierarchy" },
  { id: "ocr", label: "Sheet OCR (PaddleOCR)" },
] as const;

function MathBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--hl-line)] bg-white px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--hl-ink)]">
      {children}
    </pre>
  );
}

function ParamTable({
  rows,
}: {
  rows: { key: string; default: string; meaning: string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--hl-line)]">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead className="bg-[var(--hl-mist)]/60 text-[11px] uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2 font-medium">Parameter</th>
            <th className="px-3 py-2 font-medium">Default</th>
            <th className="px-3 py-2 font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-[var(--hl-line)]">
              <td className="px-3 py-2 font-mono text-xs text-[var(--hl-moss-deep)]">
                {row.key}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.default}</td>
              <td className="px-3 py-2 text-slate-700">{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4 border-b border-[var(--hl-line)] pb-10 last:border-b-0">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-[var(--hl-ink)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DocsToc() {
  return (
    <nav className="space-y-1 p-2 text-xs">
      <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        Contents
      </p>
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="block rounded px-2 py-1.5 text-slate-700 hover:bg-[var(--hl-mist)]/70 hover:text-[var(--hl-moss-deep)]"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

export function DocsPageClient() {
  return (
    <WorkspaceShell
      leftPanel={<DocsToc />}
      leftPanelTitle="Reference"
      showSidebar={false}
      statusText="Detection & ML reference"
      allowNewProjectShortcut={false}
      mainClassName="overflow-y-auto bg-[var(--hl-paper)]"
    >
      <article className="mx-auto max-w-3xl space-y-10 px-6 py-8 sm:px-10">
        <header className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--hl-moss)]">
            Technical reference
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--hl-ink)] sm:text-4xl">
            Detection, segmentation &amp; training
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
            Mathematics, models, and defaults used by the local inference service
            (<code className="rounded bg-white px-1 py-0.5 text-[11px]">services/inference</code>
            ). Values mirror{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[11px]">app/config.py</code> and
            Studio UI defaults.
          </p>
          <p className="text-xs text-slate-500">
            Related:{" "}
            <Link href="/studio" className="text-[var(--hl-moss)] underline-offset-2 hover:underline">
              Model Studio
            </Link>
            {" · "}
            <Link href="/projects" className="text-[var(--hl-moss)] underline-offset-2 hover:underline">
              Projects
            </Link>
          </p>
        </header>

        <Section id="overview" title="Overview">
          <p className="text-sm leading-relaxed text-slate-700">
            HighLife turns a rasterized floor-plan page into labeled geometric regions
            (walls, rooms, doors, …). The default wall path is{" "}
            <strong className="font-medium text-[var(--hl-ink)]">MitUNet</strong> semantic
            segmentation: a Mix-Transformer encoder produces a dense wall probability map,
            which is thresholded and converted to polygons. Optional YOLO / MMDetection /
            Roboflow / floorData backends swap in for walls; layout and room detectors are
            opt-in.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Load page RGB (optional resize → scale factors <em>s<sub>x</sub></em>, <em>s<sub>y</sub></em>).</li>
            <li>Optional layout crop → drawing area with pad.</li>
            <li>Run selected wall (and optional room) model, often on overlapping tiles.</li>
            <li>NMM union / wall stitch → polygons in page pixels.</li>
            <li>Scale back to original page if the raster was resized.</li>
          </ol>
        </Section>

        <Section id="pipeline" title="Detection pipeline">
          <p className="text-sm leading-relaxed text-slate-700">
            Entry point: <code className="text-xs">detect_page_regions()</code> in{" "}
            <code className="text-xs">app/yolo/predict.py</code>. Large pages use{" "}
            <code className="text-xs">maybe_tiled_detect()</code> (
            <code className="text-xs">tiling.py</code>).
          </p>
          <div className="rounded-md border border-[var(--hl-line)] bg-white p-4 font-mono text-[12px] leading-6 text-slate-800">
            {`page RGB
  → [layout YOLO?] → crop drawing area
  → wall backend (MitUNet | YOLO | MMDet | floorData | Roboflow)
       └─ if max(H,W) > min_side: overlapping tiles → per-tile infer → NMM union
  → [rooms YOLO?]
  → stitch walls (mask backends) → scale to original → regions[]`}
          </div>
          <p className="text-sm text-slate-700">
            Only <strong className="font-medium">one</strong> wall backend runs per request
            (<code className="text-xs">WALL_BACKEND</code>). Layout and room detectors are
            independent flags. Outputs are concatenated — there is no cross-class conflict
            resolver (see Overlapping regions).
          </p>
        </Section>

        <Section id="models" title="Model catalog">
          <div className="overflow-x-auto rounded-md border border-[var(--hl-line)]">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead className="bg-[var(--hl-mist)]/60 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Id / token</th>
                  <th className="px-3 py-2 font-medium">Architecture</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Runtime</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {[
                  ["wall:mitunet (default)", "Mit B4 + U-Net + scSE", "Wall masks → polygons", "PyTorch + SMP"],
                  ["wall:yolo", "YOLO OBB (GreenMap)", "Oriented wall boxes", "Ultralytics"],
                  ["wall:cascade_swin / faster_rcnn / retinanet", "MMDet → torchvision", "Wall AABB boxes", "Torchvision"],
                  ["wall:deeplab / unet_floordata", "DeepLabV3+ / UNet", "Wall masks → polygons", "TensorFlow (.venv-tf)"],
                  ["wall:roboflow", "YOLOv8n-seg ONNX", "Instance walls (+ classes)", "Ultralytics / cloud"],
                  ["layout (opt-in)", "YOLO (GreenMap)", "Drawing / legend / title", "Ultralytics"],
                  ["rooms (opt-in)", "YOLO (Architect)", "Doors, windows, fixtures", "Ultralytics"],
                  ["studio:<uuid>", "Fine-tuned base", "Custom detect / seg", "Same as base family"],
                ].map(([id, arch, role, runtime]) => (
                  <tr key={id} className="border-t border-[var(--hl-line)] align-top">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--hl-moss-deep)]">{id}</td>
                    <td className="px-3 py-2">{arch}</td>
                    <td className="px-3 py-2">{role}</td>
                    <td className="px-3 py-2 text-xs">{runtime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 text-sm leading-relaxed text-slate-700">
            <p>
              <strong className="font-medium text-[var(--hl-ink)]">MitUNet.</strong> Semantic
              segmentation with Mix-Transformer <code className="text-xs">mit_b4</code> encoder
              and U-Net decoder with scSE blocks (
              <code className="text-xs">segmentation_models_pytorch.Unet</code>
              ). Upstream checkpoint was trained with a{" "}
              <em>Tversky</em> loss (~28 epochs); this repo uses it for inference only.
              Letterbox to 512×512, ImageNet normalize, sigmoid logits → threshold 0.5.
            </p>
            <p>
              <strong className="font-medium text-[var(--hl-ink)]">floorData.</strong> TensorFlow
              DeepLabV3+ or UNet weights (<code className="text-xs">.h5</code>). Inference runs
              in a dedicated Python 3.10–3.12 venv. Multi-channel masks take channel 0 or{" "}
              <code className="text-xs">max</code> across channels — not exclusive argmax
              multi-class.
            </p>
            <p>
              <strong className="font-medium text-[var(--hl-ink)]">YOLO / Roboflow.</strong>{" "}
              Ultralytics predict with confidence filter; tile-level NMM union is applied afterward.
              Roboflow prefers local ONNX (<code className="text-xs">weights.onnx</code>), with
              cloud API fallback.
            </p>
          </div>
        </Section>

        <Section id="tiling" title="Tiling mathematics">
          <p className="text-sm leading-relaxed text-slate-700">
            Large pages are split into overlapping square windows so the network always sees
            a fixed receptive field without extreme downscaling.
          </p>
          <MathBlock>{`Gate (should_tile):
  tile when  max(H, W)  >  max(min_side, tile_size)

Stride:
  overlap ∈ [0, 0.8]
  stride  = max(1, round(tile_size × (1 − overlap)))

Default: tile_size = 640, overlap = 0.2
  ⇒ stride = round(640 × 0.8) = 512

Edge tiles: last window is snapped so the far edge of the image
is covered; crops shorter than tile_size are padded with white (255).`}</MathBlock>
          <p className="text-sm text-slate-700">
            Backend-specific tile sizes when tiling is enabled: MitUNet / floorData use{" "}
            <code className="text-xs">512</code>; YOLO walls / MMDet use{" "}
            <code className="text-xs">896</code>; rooms <code className="text-xs">640</code>;
            layout <code className="text-xs">1280</code>; Roboflow{" "}
            <code className="text-xs">640</code>.
          </p>
          <ParamTable
            rows={[
              {
                key: "DETECT_TILE_ENABLED",
                default: "true",
                meaning: "Enable overlapping-tile inference",
              },
              {
                key: "DETECT_TILE_SIZE",
                default: "640",
                meaning: "Default window side length (px)",
              },
              {
                key: "DETECT_TILE_OVERLAP",
                default: "0.2",
                meaning: "Fractional overlap between adjacent tiles",
              },
              {
                key: "DETECT_TILE_MIN_SIDE",
                default: "1280",
                meaning: "Only tile if max page side exceeds this",
              },
            ]}
          />
        </Section>

        <Section id="nms" title="Tiled post-process (NMM + union)">
          <p className="text-sm leading-relaxed text-slate-700">
            After all tiles report regions, overlapping same-class instances are{" "}
            <em>merged</em> (SAHI Greedy NMM + Shapely union), not deleted. Greedy
            box NMS is only a fallback helper — it would drop the lower-confidence
            mask fragment.
          </p>
          <MathBlock>{`Match same (type, label) if:
  IoU ≥ τ  or  IoS ≥ max(0.3, min(0.5, τ))
  or tile-edge fragments that still intersect / touch

IoS = |A ∩ B| / min(|A|, |B|)     (SAHI tiled-instance metric)

Merge (merge_tiled_regions):
  1. Union-find groups matching predictions
  2. Shapely unary_union of polygons
  3. If MultiPolygon: keep every part (nothing dropped)
  4. Confidence = max of the group; stitchedFrom = group size

Default τ = DETECT_TILE_IOU = 0.45`}</MathBlock>
          <p className="text-sm text-slate-700">
            Different labels (e.g. Wall vs Bedroom) are never merged. Ultralytics
            still runs its own NMS inside <code className="text-xs">model.predict</code>;
            the step above is the HighLife tile stitcher. One detect run uses the
            selected model — models are not ensembled together.
          </p>
        </Section>

        <Section id="masks" title="Masks → polygons">
          <p className="text-sm leading-relaxed text-slate-700">
            Semantic wall models emit a probability map. After letterbox undo:
          </p>
          <MathBlock>{`Letterbox (size S, fill 255, centered):
  scale = S / max(H, W)
  resize → pad to S×S → network
  unletterbox: crop pad, resize mask back to (H, W)

Threshold:
  binary = (p ≥ θ)     θ_MitUNet = θ_floorData = 0.5

mask_to_polygons:
  findContours(RETR_EXTERNAL)
  drop area < min_area
    MitUNet: min_area = max(16, ⌊0.0002 · H · W⌋)
    floorData default: 24
  approxPolyDP(ε),  ε = max(1, 0.002 · arcLength)
  if vertices > 80: subsample to ≤ 80

Confidence (MitUNet): mean of p on positive pixels.`}</MathBlock>
          <p className="text-sm text-slate-700">
            MitUNet inputs are ImageNet-normalized:
          </p>
          <MathBlock>{`x' = (x / 255 − μ) / σ
μ = (0.485, 0.456, 0.406)
σ = (0.229, 0.224, 0.225)`}</MathBlock>
        </Section>

        <Section id="coords" title="Coordinate systems">
          <div className="overflow-x-auto rounded-md border border-[var(--hl-line)]">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead className="bg-[var(--hl-mist)]/60 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 font-medium">Space</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {[
                  ["Editor / LabelMe / API polygonPx", "Absolute page pixels"],
                  ["YOLO label files", "Normalized [0,1]: x/W, y/H (or cx,cy,w,h)"],
                  ["Tile inference", "Local tile pixels → + (x₀, y₀)"],
                  ["Resized raster", "Multiply by sₓ, sᵧ to original page"],
                ].map(([stage, space]) => (
                  <tr key={stage} className="border-t border-[var(--hl-line)]">
                    <td className="px-3 py-2">{stage}</td>
                    <td className="px-3 py-2">{space}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="training" title="Training & losses">
          <p className="text-sm leading-relaxed text-slate-700">
            Model Studio fine-tunes run on disk under{" "}
            <code className="text-xs">services/inference/data/studio</code>. UI / API
            defaults: <strong className="font-medium">20 epochs</strong>, batch{" "}
            <strong className="font-medium">2</strong>, imgsz{" "}
            <strong className="font-medium">640</strong>.
          </p>
          <div className="space-y-4 text-sm text-slate-700">
            <div>
              <h3 className="mb-2 font-medium text-[var(--hl-ink)]">YOLO detect / segment</h3>
              <p>
                Ultralytics trainer with <code className="text-xs">patience = max(5, epochs/3)</code>,
                workers=0. Loss is Ultralytics’ default (box + cls + dfl, plus mask for seg).
                Learning rate is not overridden.
              </p>
            </div>
            <div>
              <h3 className="mb-2 font-medium text-[var(--hl-ink)]">MMDet / torchvision</h3>
              <MathBlock>{`Optimizer: AdamW(lr = 1e-4, weight_decay = 1e-4)
Loss: mean of detector loss_dict tensors (classification + box regression)`}</MathBlock>
            </div>
            <div>
              <h3 className="mb-2 font-medium text-[var(--hl-ink)]">floorData (TF)</h3>
              <MathBlock>{`Optimizer: Adam(lr = 1e-4)
Loss:   binary_crossentropy      if C = 1
        categorical_crossentropy if C > 1
Metric: accuracy
imgsz rounded down to multiple of 32 (DeepLab)`}</MathBlock>
            </div>
            <div>
              <h3 className="mb-2 font-medium text-[var(--hl-ink)]">MitUNet upstream (reference)</h3>
              <p>
                Published weights use a Tversky objective (asymmetric FN/FP weighting for thin
                walls). HighLife does not retrain MitUNet in-repo.
              </p>
              <MathBlock>{`Tversky index (typical form):
  TI = TP / (TP + α·FP + β·FN)
  L_Tversky = 1 − TI
Higher β emphasises recall on thin wall pixels.`}</MathBlock>
            </div>
          </div>
          <p className="text-sm text-slate-700">
            Train-time tiling mirrors detect: size 640, overlap 0.2, min_side 1280, with{" "}
            <code className="text-xs">TRAIN_KEEP_FULL_PAGE_FRAC = 0.15</code> chance to keep a
            full-page sample.
          </p>
        </Section>

        <Section id="params" title="Parameter reference">
          <h3 className="text-sm font-medium text-[var(--hl-ink)]">Inference confidence & size</h3>
          <ParamTable
            rows={[
              { key: "WALL_BACKEND", default: "mitunet", meaning: "Active wall detector" },
              { key: "YOLO_CONF / *_WALL_CONF / ROBOFLOW_CONF", default: "0.25", meaning: "Min score to keep a detection" },
              { key: "YOLO_IMGSZ", default: "1280", meaning: "Layout detector input size" },
              { key: "YOLO_ROOM_IMGSZ", default: "640", meaning: "Room detector input size" },
              { key: "YOLO_WALL_IMGSZ", default: "896", meaning: "YOLO / MMDet wall size" },
              { key: "MITUNET_WALL_IMGSZ", default: "512", meaning: "MitUNet letterbox size" },
              { key: "MITUNET_WALL_THRESHOLD", default: "0.5", meaning: "Wall probability cut" },
              { key: "FLOORDATA_WALL_IMGSZ", default: "512", meaning: "TF wall letterbox size" },
              { key: "FLOORDATA_WALL_THRESHOLD", default: "0.5", meaning: "TF wall probability cut" },
              { key: "DETECT_TILE_IOU", default: "0.45", meaning: "Tile NMM match IoU / IoS τ" },
              { key: "YOLO_CROP_PAD", default: "0.02", meaning: "Layout crop pad fraction" },
              { key: "USE_LAYOUT_DETECTOR", default: "false", meaning: "Enable layout YOLO" },
              { key: "USE_ROOM_DETECTOR", default: "false", meaning: "Enable room YOLO" },
            ]}
          />
          <h3 className={cn("mt-6 text-sm font-medium text-[var(--hl-ink)]")}>Studio train defaults</h3>
          <ParamTable
            rows={[
              { key: "epochs", default: "20", meaning: "Studio UI / CreateTrainBody" },
              { key: "batch", default: "2", meaning: "Mini-batch size" },
              { key: "imgsz", default: "640", meaning: "Train input size" },
              { key: "Adam / AdamW lr", default: "1e-4", meaning: "floorData & torchvision only" },
              { key: "tileSize / overlap", default: "640 / 0.2", meaning: "Generate tiles API" },
            ]}
          />
        </Section>

        <Section id="labels" title="Label classes">
          <p className="text-sm leading-relaxed text-slate-700">
            Canonical LabelMe / YOLO class list (synced with{" "}
            <code className="text-xs">classes.py</code> and{" "}
            <code className="text-xs">labelClasses.ts</code>). Default annotate class:{" "}
            <strong className="font-medium">Bedroom</strong>.
          </p>
          <ul className="flex flex-wrap gap-2">
            {LABELME_CLASSES.map((name) => (
              <li
                key={name}
                className="rounded border border-[var(--hl-line)] bg-white px-2.5 py-1 text-xs text-slate-700"
              >
                {name}
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-700">
            Aliases remapped on import: Living → Open Living, Toilet → Bathroom, Double Door →
            Single Door, Home Office → Bedroom.
          </p>
        </Section>

        <Section id="overlaps" title="Overlapping regions">
          <p className="text-sm leading-relaxed text-slate-700">
            HighLife currently treats overlaps in three different ways:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>
              <strong className="font-medium text-[var(--hl-ink)]">Same type + label</strong> —
              overlapping tile instances are Shapely-unioned (NMM). Fragments are
              not deleted.
            </li>
            <li>
              <strong className="font-medium text-[var(--hl-ink)]">Different classes</strong> —
              kept as separate polygons (wall over room is allowed). Editor paints by layer
              z-order; hit-test prefers later entities.
            </li>
            <li>
              <strong className="font-medium text-[var(--hl-ink)]">Annotation / Studio</strong> —
              no boolean subtract/union tools yet; resolve by select + delete / redraw. Studio
              “Overlap” on tiles is stride for training crops, not shape conflict UI.
            </li>
          </ul>
        </Section>

        <Section id="hierarchy" title="Building hierarchy">
          <p className="text-sm leading-relaxed text-slate-700">
            Extracted structure is a tree stored on{" "}
            <code className="text-xs">AnalysisResult.hierarchy</code>:
          </p>
          <MathBlock>{`Building (project / PDF set)
  └── Floor (page · levelName · levelIndex)
        ├── Common areas  (Lobby, Communal Space, Stair, Lift, …)
        └── Unit
              └── Room (+ doors / windows / fixtures as objects)`}</MathBlock>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>
              <strong className="font-medium">Room → unit</strong> via polygon centroid
              containment (or ≥50% bbox overlap). Common labels are never parented under a unit.
            </li>
            <li>
              <strong className="font-medium">Openings → room</strong> by centroid in the
              smallest containing room.
            </li>
            <li>
              Pages carry <code className="text-xs">levelName</code> /{" "}
              <code className="text-xs">floorId</code>. The analysis inspector{" "}
              <em>Hierarchy</em> tab builds the tree live from overlays; policy check persists it
              from the inference pipeline.
            </li>
          </ul>
        </Section>

        <Section id="ocr" title="Sheet OCR (PaddleOCR)">
          <p className="text-sm leading-relaxed text-slate-700">
            Local OCR reads title-block text from each page raster (scale, level name, unit
            ids, drawing title). It runs in a dedicated Python 3.10–3.12 venv via a worker —
            the main API venv may be 3.14 without Paddle wheels.
          </p>
          <MathBlock>{`Classic PP-OCR (default):
  .venv-ocr\\Scripts\\python.exe -m pip install -r requirements-paddle.txt

PaddleOCR-VL 0.9B (optional, GPU recommended):
  https://huggingface.co/PaddlePaddle/PaddleOCR-VL
  .venv-ocr-vl\\Scripts\\python.exe -m pip install -r requirements-paddle-vl.txt

Enable in services/inference/.env:
  PADDLE_OCR_ENABLED=true
  VLM_PROVIDER=paddleocr
  PADDLE_OCR_BACKEND=classic   # or vl
  PADDLE_OCR_PYTHON=...\\Scripts\\python.exe

UI: Analysis → OCR options → Vision model
  Classic: det/rec (det_limit_side_len, DB thresh, lang, textline orientation)
  VL: pipeline_version, layout detection, orientation, unwarping, GPU, vl_max_side
API: POST /v1/ocr/page  backend=classic|vl

Parsed fields → page.levelName, scaleText (optional auto-calibrate),
unitIds, title, sheetType. Also merged into policy analyze sheet_meta.`}</MathBlock>
        </Section>

        <footer className="pb-8 text-xs text-slate-500">
          Source of truth:{" "}
          <code className="text-[11px]">services/inference/app/config.py</code>,{" "}
          <code className="text-[11px]">app/yolo/tiling.py</code>,{" "}
          <code className="text-[11px]">app/yolo/mitunet.py</code>,{" "}
          <code className="text-[11px]">app/studio/floordata_train.py</code>,{" "}
          <code className="text-[11px]">app/pipeline/hierarchy.py</code>,{" "}
          <code className="text-[11px]">app/pipeline/paddle_ocr.py</code>.
        </footer>
      </article>
    </WorkspaceShell>
  );
}
