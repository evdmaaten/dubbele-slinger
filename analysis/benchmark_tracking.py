"""Frozen, local comparison of notebook and existing colour-marker tracking.

No notebook is executed. Only the inspected detect_red_point FunctionDef is
compiled with cv2/np. Input video, notebook, tracking and quality files are
read-only. All predictions, manifests and later annotation scores stay local.

Usage:
  python analysis/benchmark_tracking.py run --video VIDEO --notebook NOTEBOOK
  python analysis/benchmark_tracking.py score --annotations-a A --annotations-b B
"""
import argparse
import ast
import csv
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import time

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
REGULAR = [round(i * 2491 / 24) for i in range(25)]
STRESS = [360, 375, 385, 405, 420, 450]
SELECTED = sorted(set(REGULAR + STRESS))
FIELDS = ["frame", "t_video_s", "cohort", "method", "marker", "x_px", "y_px",
          "detected", "accepted", "quality_reason", "area_px"]


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_csv(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def write_csv(path, rows, fields):
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def named_function(source, name):
    tree = ast.parse(source)
    matches = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    if len(matches) != 1 or matches[0].decorator_list:
        raise ValueError(f"Expected one undecorated top-level {name} function")
    return matches[0], ast.get_source_segment(source, matches[0])


def notebook_function(notebook):
    document = json.loads(Path(notebook).read_text(encoding="utf-8-sig"))
    found = []
    for index, cell in enumerate(document.get("cells", [])):
        if cell.get("cell_type") != "code":
            continue
        source = "".join(cell.get("source", []))
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "detect_red_point":
                if node.decorator_list:
                    raise ValueError("Notebook function unexpectedly has decorators")
                found.append((index, node, ast.get_source_segment(source, node)))
    if len(found) != 1:
        raise ValueError("Expected exactly one detect_red_point definition in the notebook")
    return found[0]


def compile_functions(nodes):
    """Only supplied function definitions; no imports, notebook cells or main."""
    namespace = {
        "cv2": cv2, "np": np,
        "__builtins__": {"max": max, "int": int, "float": float, "abs": abs,
                         "map": map, "range": range},
    }
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(module, "<inspected-tracker-functions>", "exec"), namespace)
    return namespace


def controlled_notebook(hsv, marker):
    """Original contour/morphology/centroid route; only HSV and ROI differ.

    The mask is exactly the broad mask in track_video.marker, before connected
    components, area/width/height, hue scoring, or any distance gates.
    """
    h, s, v = cv2.split(hsv)
    if marker == "green":
        mask = (h >= 29) & (h <= 95) & (s > 70) & (v > 40)
    else:
        mask = (h <= 18) & (s > 155) & (v > 75)
    mask[:30] = False
    mask[550:] = False
    mask[:, :180] = False
    mask[:, 850:] = False
    mask = mask.astype(np.uint8) * 255
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None, 0
    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)
    if area < 10:
        return None, None, float(area)
    moments = cv2.moments(largest)
    if moments["m00"] == 0:
        return None, None, float(area)
    return int(moments["m10"] / moments["m00"]), int(moments["m01"] / moments["m00"]), float(area)


def freeze_manifest(args):
    directory = args.output
    directory.mkdir(parents=True, exist_ok=True)
    raw_path = args.tracking / "tracking-raw.csv"
    quality_path = args.tracking / "tracking-quality.csv"
    metadata_path = args.tracking / "tracking-metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    source_hashes = {
        "video": digest(args.video), "notebook": digest(args.notebook),
        "tracking_raw": digest(raw_path), "tracking_quality": digest(quality_path),
        "tracker_source": digest(ROOT / "analysis" / "track_video.py"),
    }
    if source_hashes["video"] != metadata["sha256"] or metadata["frames"] != 2492:
        raise ValueError("Existing tracking does not belong to the requested 2492-frame source video")
    summary = json.loads((args.tracking / "measurement-summary.json").read_text(encoding="utf-8"))
    if summary["raw_csv_sha256"] != source_hashes["tracking_raw"]:
        raise ValueError("Existing quality report refers to different raw tracking")
    cell_index, node, source = notebook_function(args.notebook)
    manifest = {
        "schema": "dubbele-slinger/tracker-benchmark-v1",
        "source_hashes": source_hashes,
        "expected_frames": 2492, "width": 1024, "height": 576, "playback_fps": 30,
        "selection_fixed_before_predictions_and_labels": True,
        "regular_rule": "round(i*2491/24), i=0..24; 25 frames",
        "regular_frames": REGULAR, "stress_frames": STRESS, "all_selected_frames": SELECTED,
        "primary_accuracy_sample": "25 regular frames; 6 stress frames reported separately, never pooled silently",
        "blind_reference_images": "Provided separately by prepare_tracking_reference.py; no predicted positions shown to observers",
        "notebook_function": {
            "cell_index": cell_index, "name": "detect_red_point",
            "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
            "execution": "Only AST FunctionDef with cv2/np; no whole notebook or process_video execution",
        },
        "methods": {
            "notebook_original": {
                "target": "orange only (the original notebook tracks one red point, not two markers)",
                "mask": "Original H 0..10 or 170..180, S 80..255, V 50..255; full frame",
                "algorithm": "Original 5x5 opening/closing, largest external contour, area>=10, integer moment centroid",
            },
            "notebook_controlled": {
                "target": "orange and green, independently",
                "mask": "Same broad HSV masks and fixed ROI as ours; all other notebook contour steps retained",
                "orange_mask": "H<=18; S>155; V>75",
                "green_mask": "29<=H<=95; S>70; V>40",
                "roi": {"x_inclusive": 180, "x_exclusive": 850, "y_inclusive": 30, "y_exclusive": 550},
                "algorithm": "5x5 opening then closing; largest external contour; area>=10; integer moment centroid",
                "excluded": "No connected-component hue ranking, width/height gates, distance gates, temporal screen, or simulator correction",
            },
            "ours": {
                "target": "orange and green",
                "algorithm": "Existing marker and match_patch functions; per-frame component/hue scoring and existing image-distance gates",
                "quality": "Existing frozen pair-level quality CSV, reported separately from all raw predictions",
                "qualification": "Existing quality includes prior manual rejection of frame385; not claimed to be a fully automatic blind filter",
                "identity_check": "Recompute pivot, both marker centres and areas on all2492 sequentially decoded frames against existing raw CSV",
            },
        },
        "scoring_plan": {
            "reference": "Two independent observers; compare their annotations before algorithm accuracy",
            "coordinate_system": "Native 1024x576 pixels, x right, y down; no scale or perspective correction",
            "primary_metrics": ["detection coverage", "median and mean Euclidean pixel error", "RMSE", "p90 error", "fraction within5pixels", "fraction within10pixels"],
            "quality_policy": "Report ours raw and quality-accepted variants; rejections count as abstentions rather than silently disappearing",
            "annotation_tuning_policy": "Independent annotation values are not read or used to tune tracker methods, thresholds, or selected frames. Annotation files may already exist when this implementation manifest is written.",
            "limitations": "Same previously inspected recording; no claim of generalization or independent metrological ground truth",
        },
    }
    path = directory / "frozen-manifest.json"
    if path.exists():
        frozen = json.loads(path.read_text(encoding="utf-8"))
        immutable = ["schema", "source_hashes", "expected_frames", "width", "height", "playback_fps",
                     "regular_rule", "regular_frames", "stress_frames", "all_selected_frames", "notebook_function", "methods"]
        if any(frozen[key] != manifest[key] for key in immutable):
            raise ValueError("Frozen benchmark manifest differs. Refusing to overwrite the predeclared protocol.")
        # Preserve the original file and hash, including any subsequently
        # corrected provenance wording. Reporting amendments are separate.
    else:
        manifest["frozen_at_utc"] = datetime.now(timezone.utc).isoformat()
        with path.open("x", encoding="utf-8") as stream:
            json.dump(manifest, stream, indent=2)
            stream.write("\n")
    (directory / "notebook-detect-red-point.py").write_text(source + "\n", encoding="utf-8")
    print(f"Frozen manifest: {path}; SHA256={digest(path)}", flush=True)
    return manifest, node


def run_benchmark(args):
    manifest, notebook_node = freeze_manifest(args)
    original = compile_functions([notebook_node])["detect_red_point"]
    tracker_text = (ROOT / "analysis" / "track_video.py").read_text(encoding="utf-8")
    marker_node, marker_source = named_function(tracker_text, "marker")
    pivot_node, pivot_source = named_function(tracker_text, "match_patch")
    ours = compile_functions([marker_node, pivot_node])
    (args.output / "ours-functions.py").write_text(marker_source + "\n\n" + pivot_source + "\n", encoding="utf-8")
    raw = read_csv(args.tracking / "tracking-raw.csv")
    quality = read_csv(args.tracking / "tracking-quality.csv")
    if len(raw) != 2492 or len(quality) != len(raw) or any(int(r["frame"]) != i for i, r in enumerate(quality)):
        raise ValueError("Unexpected raw/quality row alignment")
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise ValueError("Cannot open video")
    if abs(capture.get(cv2.CAP_PROP_FPS) - 30) > 1e-6:
        raise ValueError("Unexpected playback rate")
    started = time.perf_counter()
    predictions, identity_rows = [], []
    max_error, mismatch_count = 0., 0
    pivot0 = np.array([504., 74.])
    template = None
    i = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if i >= len(raw) or frame.shape[:2] != (576, 1024):
            raise ValueError("Unexpected decoded frame count or dimensions")
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if template is None:
            template = gray[64:85, 494:515].copy()
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        cohort = "regular" if i in REGULAR else "stress" if i in STRESS else "unlabelled"
        common = {"frame": i, "t_video_s": raw[i]["t_video_s"], "cohort": cohort}

        def add(method, name, x, y, area=None, accepted=None, reason=""):
            detected = x is not None and y is not None and math.isfinite(float(x)) and math.isfinite(float(y))
            predictions.append({**common, "method": method, "marker": name,
                                "x_px": float(x) if detected else "", "y_px": float(y) if detected else "",
                                "detected": int(detected), "accepted": int(detected if accepted is None else accepted),
                                "quality_reason": reason, "area_px": area if area is not None else ""})

        x, y, _mask, _unused_annotation = original(frame)
        add("notebook_original", "orange", x, y)
        for name in ["orange", "green"]:
            x, y, area = controlled_notebook(hsv, name)
            add("notebook_controlled", name, x, y, area)

        pivot, _ = ours["match_patch"](gray, template, pivot0)
        orange, oa = ours["marker"](hsv, "orange", reference=pivot, distance_bounds=(210, 260))
        green, ga = ours["marker"](hsv, "green", reference=orange, distance_bounds=(120, 185))
        expected = np.array([float(raw[i][field]) for field in ["pivot_x_px", "pivot_y_px", "orange_x_px", "orange_y_px", "green_x_px", "green_y_px"]])
        recomputed = np.r_[pivot, orange, green]
        same = bool(np.allclose(expected, recomputed, atol=1e-8, rtol=0, equal_nan=True)
                    and int(raw[i]["orange_area_px"]) == oa and int(raw[i]["green_area_px"]) == ga)
        finite = np.isfinite(expected) & np.isfinite(recomputed)
        error = float(np.max(np.abs(expected[finite] - recomputed[finite]))) if finite.any() else 0.
        max_error = max(max_error, error)
        mismatch_count += int(not same)
        identity_rows.append({"frame": i, "identical_within_1e-8": int(same), "max_abs_error_px": error,
                              "pivot_x_px": pivot[0], "pivot_y_px": pivot[1],
                              "orange_x_px": orange[0], "orange_y_px": orange[1],
                              "green_x_px": green[0], "green_y_px": green[1]})
        # Benchmark the frozen original raw coordinates, retaining all failures.
        for name in ["orange", "green"]:
            add("ours", name, float(raw[i][f"{name}_x_px"]), float(raw[i][f"{name}_y_px"]),
                int(raw[i][f"{name}_area_px"]), quality[i]["accepted"] == "1", quality[i]["reason"])
        i += 1
        if i % 500 == 0:
            print(f"Compared {i}/2492 identical decoded frames", flush=True)
    capture.release()
    if i != 2492:
        raise ValueError(f"Expected2492 frames, decoded{i}")
    protected = {"video": args.video, "notebook": args.notebook,
                 "tracking_raw": args.tracking / "tracking-raw.csv", "tracking_quality": args.tracking / "tracking-quality.csv",
                 "tracker_source": ROOT / "analysis" / "track_video.py"}
    final_hashes = {name: digest(path) for name, path in protected.items()}
    if final_hashes != manifest["source_hashes"]:
        raise ValueError("An input source changed during the benchmark")
    write_csv(args.output / "predictions-all-frames.csv", predictions, FIELDS)
    write_csv(args.output / "predictions-selected-frames.csv", [r for r in predictions if r["frame"] in SELECTED], FIELDS)
    write_csv(args.output / "ours-identity-check.csv", identity_rows, list(identity_rows[0]))
    summary = {
        "status": "PREDICTIONS_ONLY; independent annotations required before accuracy claims",
        "frozen_manifest_sha256": digest(args.output / "frozen-manifest.json"),
        "decoded_frames": i, "prediction_rows": len(predictions), "elapsed_seconds": time.perf_counter() - started,
        "ours_identity": {"checked_frames": i, "mismatched_frames": mismatch_count, "max_absolute_coordinate_difference_px": max_error,
                          "tolerance_px": 1e-8, "both_marker_areas_checked": True},
        "input_hashes_before": manifest["source_hashes"], "input_hashes_after": final_hashes,
        "libraries": {"opencv": cv2.__version__, "numpy": np.__version__},
        "annotation_status": "No independent annotation values are read by the tracker execution or used to tune its methods; files may exist independently.",
    }
    (args.output / "prediction-run.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)
    if mismatch_count:
        raise RuntimeError("Stored ours tracking did not exactly reproduce; do not score until investigated")


def load_annotations(path):
    path = Path(path)
    if path.suffix.lower() == ".csv":
        rows = read_csv(path)
    else:
        document = json.loads(path.read_text(encoding="utf-8-sig"))
        rows = document if isinstance(document, list) else document["rows"]
    annotations = {}
    for row in rows:
        frame = int(row["frame"])
        marker = row["marker"].strip().lower()
        if marker not in ["orange", "green"] or frame not in SELECTED:
            raise ValueError("Annotation outside predeclared frames/markers")
        key = (frame, marker)
        if key in annotations:
            raise ValueError(f"Duplicate annotation{key}")
        visible = str(row.get("visible", True)).lower() not in ["false", "0", "no", ""]
        try:
            x, y = float(row["x_px"]), float(row["y_px"])
            visible = visible and math.isfinite(x) and math.isfinite(y)
        except (ValueError, TypeError, KeyError):
            x = y = None
            visible = False
        annotations[key] = {**row, "frame": frame, "marker": marker, "visible": visible, "x_px": x, "y_px": y}
    return annotations


def audit_timing(args):
    """Compare integer PTS/timebase with index/fps, without physical-time claims."""
    frozen = json.loads((args.output / "frozen-manifest.json").read_text())
    before = digest(args.video)
    if before != frozen["source_hashes"]["video"]:
        raise ValueError("Timing source differs from frozen benchmark video")
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate,time_base:frame=best_effort_timestamp,best_effort_timestamp_time",
        "-of", "json", str(args.video),
    ], text=True))
    stream = probe["streams"][0]
    fps = Fraction(stream["avg_frame_rate"])
    time_base = Fraction(stream["time_base"])
    pts = [Fraction(frame["best_effort_timestamp"]) * time_base for frame in probe["frames"]]
    if len(pts) != 2492:
        raise ValueError("Unexpected timestamp count")
    raw = read_csv(args.tracking / "tracking-raw.csv")
    differences = [Fraction(i, 1) / fps - timestamp for i, timestamp in enumerate(pts)]
    exported_differences = [Fraction(row["t_video_s"]) - timestamp for row, timestamp in zip(raw, pts)]
    after = digest(args.video)
    if before != after:
        raise ValueError("Video changed during timing audit")
    result = {
        "video_sha256_before": before, "video_sha256_after": after,
        "frame_count": len(pts), "avg_frame_rate": str(fps), "stream_time_base": str(time_base),
        "max_absolute_index_over_fps_minus_pts_seconds": float(max(map(abs, differences))),
        "exact_rational_equality_for_every_frame": all(value == 0 for value in differences),
        "max_absolute_exported_csv_time_minus_pts_seconds": float(max(map(abs, exported_differences))),
        "note": "The exported CSV timestamps are rounded to six decimals. Index/fps agrees with integer PTS here; FFprobe is not credited with a spatial accuracy improvement.",
        "physical_time_scale": "UNKNOWN; playback timestamps do not establish the acquisition-time or slow-motion conversion.",
    }
    (args.output / "timing-audit.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


def distribution(values):
    values = np.asarray(values, dtype=float)
    if not len(values):
        return {"count": 0, "median": None, "mean": None, "rmse": None, "p90": None, "max": None}
    return {"count": len(values), "median": float(np.median(values)),
            "mean": float(np.mean(values)), "rmse": float(np.sqrt(np.mean(values ** 2))),
            "p90": float(np.percentile(values, 90)), "max": float(np.max(values))}


def validate_predictions(directory):
    combinations = [("notebook_original", "orange"), ("notebook_controlled", "orange"),
                    ("notebook_controlled", "green"), ("ours", "orange"), ("ours", "green")]
    indexed = []
    for filename, frames in [("predictions-all-frames.csv", range(2492)),
                             ("predictions-selected-frames.csv", SELECTED)]:
        rows = read_csv(directory / filename)
        keys = [(int(row["frame"]), row["method"], row["marker"]) for row in rows]
        expected = {(i, method, marker) for i in frames for method, marker in combinations}
        if len(keys) != len(set(keys)) or set(keys) != expected:
            raise ValueError(f"Prediction keys missing, duplicate, or unexpected in {filename}")
        for row in rows:
            i = int(row["frame"])
            cohort = "regular" if i in REGULAR else "stress" if i in STRESS else "unlabelled"
            if row["cohort"] != cohort or row["detected"] not in ["0", "1"] or row["accepted"] not in ["0", "1"]:
                raise ValueError(f"Invalid prediction flags or cohort in {filename}")
            if row["detected"] == "1" and not all(math.isfinite(float(row[k])) for k in ["x_px", "y_px"]):
                raise ValueError("Detected prediction requires finite coordinates")
        indexed.append(dict(zip(keys, rows)))
    if any(indexed[0][key] != row for key, row in indexed[1].items()):
        raise ValueError("Selected prediction rows differ from the all-frame export")
    return list(indexed[1].values())


def write_provenance_amendment(args, prediction_hashes):
    manifest_hash = digest(args.output / "frozen-manifest.json")
    historical_run = manifest_hash == "905299873ff15b86129d4b2fc1b1c715c9efc87b6a5271c747bc357f99d02e91"
    names = ["reference-protocol.json", "frozen-manifest.json", "prediction-run.json"]
    paths = [(name, args.output / name) for name in names]
    paths += [("annotations-A.json", args.annotations_a), ("annotations-B.json", args.annotations_b)]
    timeline = [{"file": name, "sha256": digest(path),
                 "observed_file_mtime_utc": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}
                for name, path in paths]
    amendment = {
        "schema": "dubbele-slinger/tracker-provenance-amendment-v1",
        "written_at_utc": datetime.now(timezone.utc).isoformat(),
        "original_frozen_manifest_sha256": manifest_hash,
        "original_prediction_run_sha256": digest(args.output / "prediction-run.json"),
        "prediction_sha256": prediction_hashes, "observed_timeline": timeline,
        "correction": ("The original manifest's annotations_not_available_at_freeze=true and prediction-run's 'Not read or available' wording were too absolute. Annotation A already existed when the implementation manifest was written. The original files are preserved unchanged; this amendment supersedes those availability claims."
                       if historical_run else "No historical availability correction is applied to this manifest. Observed file modification times and hashes are recorded without inferring when annotation values became available or were read."),
        "protocol_timing": ("The separate reference-protocol.json fixed the selected regular/stress frames and 5/10 px thresholds before either annotation file. The later implementation manifest must not be represented as having preceded annotation-file existence."
                            if historical_run else "No preregistration or annotation-availability timing claim is made for this run. Any such claim requires separate evidence; filesystem modification times alone do not establish it."),
        "no_label_driven_tuning": "Independent annotation coordinate values were not read or used to change detector algorithms, thresholds, or selected frames. Schema/count inspection occurred before scoring. No detector rerun or tuning is performed during scoring.",
        "timeline_qualification": "Filesystem modification times are observed evidence, not independently attested creation timestamps.",
        "reference_qualification": "Two independent AI visual readings, not calibrated human or metrological ground truth.",
    }
    path = args.output / "provenance-amendment.json"
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        for key in ["original_frozen_manifest_sha256", "original_prediction_run_sha256", "prediction_sha256"]:
            if existing[key] != amendment[key]:
                raise ValueError("An amended immutable benchmark input changed")
    else:
        with path.open("x", encoding="utf-8") as stream:
            json.dump(amendment, stream, indent=2)
            stream.write("\n")
    return path


def validate_annotation_set(annotations, reader):
    expected = {(frame, marker) for frame in SELECTED for marker in ["orange", "green"]}
    if set(annotations) != expected:
        raise ValueError(f"{reader}: expected all62 predefined marker labels; missing or extra keys")
    for row in annotations.values():
        if row["visible"]:
            if not (0 <= row["x_px"] < 1024 and 0 <= row["y_px"] < 576):
                raise ValueError(f"{reader}: visible point outside native image")
            uncertainty = float(row["uncertainty_px"])
            if not math.isfinite(uncertainty) or uncertainty < 0:
                raise ValueError(f"{reader}: invalid visual uncertainty")


def score_benchmark(args):
    """Frozen detections, complete reference validation and same-frame comparisons."""
    manifest_path = args.output / "frozen-manifest.json"
    run = json.loads((args.output / "prediction-run.json").read_text(encoding="utf-8"))
    if run["frozen_manifest_sha256"] != digest(manifest_path) or run["ours_identity"]["mismatched_frames"]:
        raise ValueError("Benchmark manifest or ours identity was not verified")
    protocol = json.loads((args.output / "reference-protocol.json").read_text(encoding="utf-8"))
    if protocol["regular_frames"] != REGULAR or protocol["stress_frames"] != STRESS or protocol["predeclared_error_thresholds_px"] != [5, 10]:
        raise ValueError("Frame selection or thresholds differ from initial reference protocol")
    predictions = validate_predictions(args.output)
    prediction_hashes = {name: digest(args.output / name) for name in ["predictions-all-frames.csv", "predictions-selected-frames.csv"]}
    amendment_path = write_provenance_amendment(args, prediction_hashes)
    plan = {
        "written_at_utc": datetime.now(timezone.utc).isoformat(),
        "qualification": "Scoring specification recorded before this scorer loads annotation coordinates; not a claim that the annotation files did not exist or that this plan predates all informal checks.",
        "scorer_sha256": digest(Path(__file__)), "prediction_sha256": prediction_hashes,
        "expected_labels_per_reader": 62, "thresholds_px": [5, 10],
        "reference": "Mean of both visible reader centres; no disagreement-based exclusions",
        "exclusions": "Only missing/invalid visibility; incomplete or duplicate label keys are errors",
        "uncertainty": "max(reader_A_uncertainty, reader_B_uncertainty, reader_distance/2), a conservative visual scale, not a calibrated interval",
        "paired_comparison": "Common-valid same-frame errors, ours minus comparator; raw and quality variants, regular and stress, each reader and consensus kept separate",
        "paired_sensitivity_screen": "abs(error difference) <= 2*visual uncertainty is not clear separation at this visual scale; not a confidence interval or statistical test",
    }
    plan_path = args.output / "scoring-plan.json"
    if not plan_path.exists():
        with plan_path.open("x", encoding="utf-8") as stream:
            json.dump(plan, stream, indent=2)
            stream.write("\n")
    a, b = load_annotations(args.annotations_a), load_annotations(args.annotations_b)
    validate_annotation_set(a, "reader A")
    validate_annotation_set(b, "reader B")
    references, agreements, exclusions = {}, [], []
    for key in sorted(a):
        ra, rb = a[key], b[key]
        cohort = "regular" if key[0] in REGULAR else "stress"
        if not (ra["visible"] and rb["visible"]):
            exclusions.append({"frame": key[0], "marker": key[1], "cohort": cohort,
                               "visible_a": ra["visible"], "visible_b": rb["visible"],
                               "reason": "At least one reader marked invisible or supplied nonfinite/missing coordinates"})
            continue
        separation = math.hypot(ra["x_px"] - rb["x_px"], ra["y_px"] - rb["y_px"])
        ux, uy = (ra["x_px"] + rb["x_px"]) / 2, (ra["y_px"] + rb["y_px"]) / 2
        uncertainty = max(float(ra["uncertainty_px"]), float(rb["uncertainty_px"]), separation / 2)
        references[key] = {"consensus": (ux, uy), "reader_a": (ra["x_px"], ra["y_px"]),
                           "reader_b": (rb["x_px"], rb["y_px"]), "uncertainty": uncertainty}
        agreements.append({"frame": key[0], "cohort": cohort, "marker": key[1], "observer_distance_px": separation,
                           "reader_a_x_px": ra["x_px"], "reader_a_y_px": ra["y_px"],
                           "reader_b_x_px": rb["x_px"], "reader_b_y_px": rb["y_px"],
                           "uncertainty_a_px": float(ra["uncertainty_px"]), "uncertainty_b_px": float(rb["uncertainty_px"]),
                           "conservative_visual_uncertainty_px": uncertainty, "reference_x_px": ux, "reference_y_px": uy})
    details = []
    for row in predictions:
        key = (int(row["frame"]), row["marker"])
        if key not in references:
            continue
        ref = references[key]
        for variant in ["raw", "quality_accepted"] if row["method"] == "ours" else ["raw"]:
            detected = row["detected"] == "1" and (variant != "quality_accepted" or row["accepted"] == "1")
            errors = {}
            for name, field in [("consensus", "error_px"), ("reader_a", "error_reader_a_px"), ("reader_b", "error_reader_b_px")]:
                errors[field] = math.hypot(float(row["x_px"]) - ref[name][0], float(row["y_px"]) - ref[name][1]) if detected else ""
            details.append({"frame": key[0], "cohort": row["cohort"], "method": row["method"], "variant": variant,
                            "marker": key[1], "detected": int(detected), "prediction_x_px": row["x_px"], "prediction_y_px": row["y_px"],
                            **errors, "conservative_visual_uncertainty_px": ref["uncertainty"]})
    summaries, observer_summaries, paired_summaries, paired_rows = [], [], [], []
    for cohort in ["regular", "stress"]:
        for marker in ["orange", "green"]:
            group = [r for r in agreements if (r["cohort"], r["marker"]) == (cohort, marker)]
            observer_summaries.append({"cohort": cohort, "marker": marker,
                                      **{name: distribution([r[field] for r in group]) for name, field in [
                                          ("reader_disagreement_px", "observer_distance_px"), ("reader_a_uncertainty_px", "uncertainty_a_px"),
                                          ("reader_b_uncertainty_px", "uncertainty_b_px"), ("conservative_visual_uncertainty_px", "conservative_visual_uncertainty_px")]}})
            methods = [("notebook_controlled", "raw"), ("ours", "raw"), ("ours", "quality_accepted")]
            if marker == "orange":
                methods.insert(0, ("notebook_original", "raw"))
            for method, variant in methods:
                rows = [r for r in details if (r["cohort"], r["marker"], r["method"], r["variant"]) == (cohort, marker, method, variant)]
                errors = [r["error_px"] for r in rows if r["detected"]]
                stats = distribution(errors)
                summary = {"cohort": cohort, "marker": marker, "method": method, "variant": variant,
                           "reference_count": len(rows), "detected_count": len(errors), "abstention_count": len(rows)-len(errors),
                           "coverage": len(errors)/len(rows) if rows else None,
                           "consensus_error_px": stats,
                           "reader_a_error_px": distribution([r["error_reader_a_px"] for r in rows if r["detected"]]),
                           "reader_b_error_px": distribution([r["error_reader_b_px"] for r in rows if r["detected"]]),
                           "median_error_px": stats["median"], "mean_error_px": stats["mean"], "rmse_px": stats["rmse"], "p90_error_px": stats["p90"]}
                for threshold in [5, 10]:
                    count = sum(value <= threshold for value in errors)
                    summary[f"within{threshold}px_count"] = count
                    summary[f"within{threshold}px_all_reference_fraction"] = count / len(rows) if rows else None
                summaries.append(summary)
            for comparator in ["notebook_controlled"] + (["notebook_original"] if marker == "orange" else []):
                other = {r["frame"]: r for r in details if (r["cohort"], r["marker"], r["method"]) == (cohort, marker, comparator) and r["detected"]}
                for variant in ["raw", "quality_accepted"]:
                    ours = {r["frame"]: r for r in details if (r["cohort"], r["marker"], r["method"], r["variant"]) == (cohort, marker, "ours", variant) and r["detected"]}
                    common = sorted(set(ours) & set(other))
                    for reference, field in [("consensus", "error_px"), ("reader_a", "error_reader_a_px"), ("reader_b", "error_reader_b_px")]:
                        pairs = [{"frame": frame, "cohort": cohort, "marker": marker, "ours_variant": variant,
                                  "comparator": comparator, "reference": reference,
                                  "ours_error_px": ours[frame][field], "comparator_error_px": other[frame][field],
                                  "difference_px": ours[frame][field]-other[frame][field],
                                  "conservative_visual_uncertainty_px": ours[frame]["conservative_visual_uncertainty_px"]} for frame in common]
                        paired_rows.extend(pairs)
                        paired_summaries.append({"cohort": cohort, "marker": marker, "ours_variant": variant,
                                                "comparator": comparator, "reference": reference,
                                                "common_valid_count": len(common), "frames": common,
                                                "difference_definition": "ours error minus comparator error; negative favours ours",
                                                "paired_error_difference_px": distribution([p["difference_px"] for p in pairs]),
                                                "ours_error_px": distribution([p["ours_error_px"] for p in pairs]),
                                                "comparator_error_px": distribution([p["comparator_error_px"] for p in pairs]),
                                                "ours_better_beyond_2u_count": sum(p["difference_px"] < -2*p["conservative_visual_uncertainty_px"] for p in pairs),
                                                "ours_worse_beyond_2u_count": sum(p["difference_px"] > 2*p["conservative_visual_uncertainty_px"] for p in pairs),
                                                "within_2u_count": sum(abs(p["difference_px"]) <= 2*p["conservative_visual_uncertainty_px"] for p in pairs),
                                                "screen_qualification": "2u is a conservative visual-reference sensitivity screen, not a calibrated interval or statistical test"})
    write_csv(args.output / "observer-agreement.csv", agreements, list(agreements[0]) if agreements else ["frame", "marker", "observer_distance_px"])
    write_csv(args.output / "annotation-exclusions.csv", exclusions, ["frame", "marker", "cohort", "visible_a", "visible_b", "reason"])
    write_csv(args.output / "accuracy-by-frame.csv", details, list(details[0]) if details else ["frame", "cohort", "method", "variant", "marker", "detected", "error_px"])
    write_csv(args.output / "paired-common-valid.csv", paired_rows, list(paired_rows[0]) if paired_rows else ["frame", "difference_px"])
    result = {
        "schema": "dubbele-slinger/tracker-accuracy-v2", "scored_at_utc": datetime.now(timezone.utc).isoformat(),
        "frozen_manifest_sha256": digest(manifest_path), "prediction_run_sha256": digest(args.output / "prediction-run.json"),
        "prediction_sha256": prediction_hashes, "provenance_amendment_sha256": digest(amendment_path), "scoring_plan_sha256": digest(plan_path),
        "scorer_sha256": digest(Path(__file__)),
        "scoring_plan_role": "Preserved historical scoring specification; scorer_sha256 identifies the actual implementation for this execution separately from the plan's original scorer hash.",
        "annotation_a_sha256": digest(args.annotations_a), "annotation_b_sha256": digest(args.annotations_b),
        "prediction_validation": {"all_frame_keys": 12460, "selected_frame_keys": 155, "unique_and_complete": True, "selected_rows_exactly_match_all_frame_rows": True},
        "annotation_validation": {"expected_labels_per_reader": 62, "reader_a_labels": len(a), "reader_b_labels": len(b), "excluded_labels": len(exclusions)},
        "reference_policy": "Mean of two independently visible AI-reader centres; no disagreement-based exclusions",
        "visual_uncertainty_policy": "max(uA,uB,reader_distance/2); conservative visual scale, not a calibrated interval",
        "paired_reference_count": len(references), "annotation_exclusions": exclusions,
        "observer_agreement": agreements, "observer_summaries": observer_summaries,
        "observer_agreement_all_px": distribution([r["observer_distance_px"] for r in agreements]),
        "summaries": summaries, "paired_comparisons": paired_summaries,
        "limitations": ["AI visual readings are image references, not calibrated physical ground truth; small differences do not establish an accuracy winner.",
                        "25 regular and6 deliberately difficult stress frames remain separate; small sample and related video frames.",
                        "Our frozen quality filter includes prior manual rejection of frame385, so it is not fully automatic blind QC.",
                        "The original manifest availability wording is corrected in provenance-amendment.json while originals remain unchanged.",
                        "No green baseline is invented for the original one-red-point notebook.",
                        "This video was already used to tune our HSV/gates; no out-of-recording generalization claim."]}
    (args.output / "accuracy-summary.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"paired_reference_count": len(references), "observer_agreement_all_px": result["observer_agreement_all_px"],
                      "summaries": summaries}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["run", "freeze", "timing", "score"])
    parser.add_argument("--video", type=Path)
    parser.add_argument("--notebook", type=Path)
    parser.add_argument("--tracking", type=Path, default=ROOT / ".local-data" / "video-analyse")
    parser.add_argument("--output", type=Path, default=ROOT / ".local-data" / "tracker-benchmark")
    parser.add_argument("--annotations-a", type=Path)
    parser.add_argument("--annotations-b", type=Path)
    args = parser.parse_args()
    if args.stage == "timing":
        if not args.video:
            parser.error("timing requires --video")
        audit_timing(args)
    elif args.stage == "score":
        if not args.annotations_a or not args.annotations_b:
            parser.error("score requires --annotations-a and --annotations-b")
        score_benchmark(args)
    else:
        if not args.video or not args.notebook:
            parser.error("run/freeze requires --video and --notebook")
        if args.stage == "freeze":
            freeze_manifest(args)
        else:
            run_benchmark(args)


if __name__ == "__main__":
    main()
