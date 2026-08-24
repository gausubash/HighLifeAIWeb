"""Region detection for overlay.

Default path is the Hugging Face YOLO11x layout detector via the inference
service. OpenCV remains available as DETECT_BACKEND=opencv for tests and fallback.
"""

from app.detect.pipeline import DetectedRegion, detect_page_regions, detect_with_opencv

__all__ = ["DetectedRegion", "detect_page_regions"]
