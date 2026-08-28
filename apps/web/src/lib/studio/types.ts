export type StudioTask = "detect" | "segment";

export type StudioModelCategory =
  | "layout_analysis"
  | "wall_detection"
  | "room_detection"
  | "wall_segmentation"
  | "general_detection"
  | "general_segmentation";

export type StudioPage = {
  id: string;
  source_name: string;
  source_path?: string | null;
  page_number: number;
  width_px: number;
  height_px: number;
  labeled: boolean;
  shape_count: number;
  link?: boolean;
  kind?: string;
  labels_path?: string | null;
  split?: "train" | "test";
  dpi?: number;
  converted_from_pdf?: boolean;
};

export type MlDataset = {
  id: string;
  name: string;
  task: StudioTask;
  category?: StudioModelCategory | string | null;
  class_names: string[];
  pages: StudioPage[];
  linked_paths?: string[];
  image_count: number;
  labeled_count: number;
  train_count?: number;
  test_count?: number;
  ready: boolean;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
  added_count?: number;
  removed_count?: number;
  converted_count?: number;
  pdf_page_count?: number;
  image_page_count?: number;
};

export type MlTrainingJob = {
  id: string;
  dataset_id: string;
  task: StudioTask;
  base_model: string;
  epochs: number;
  imgsz: number;
  batch: number;
  model_name?: string | null;
  status: string;
  progress: number;
  metrics: Record<string, unknown> | null;
  metrics_history?: Record<string, unknown>[];
  preview_epoch?: number | null;
  preview_updated_at?: string | null;
  log_tail: string | null;
  error: string | null;
  output_model_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type MlModel = {
  id: string;
  dataset_id: string | null;
  training_job_id: string | null;
  name: string;
  task: StudioTask;
  architecture: string;
  category?: StudioModelCategory | string | null;
  storage_path: string;
  class_names: string[];
  metrics: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
};
