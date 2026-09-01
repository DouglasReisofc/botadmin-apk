#!/usr/bin/env python3
import argparse
import json
import sys

from faster_whisper import WhisperModel


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe one audio file with local faster-whisper.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="pt")
    parser.add_argument("--beam-size", type=int, default=3)
    parser.add_argument("--initial-prompt", default=None)
    args = parser.parse_args()

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    segments, info = model.transcribe(
        args.audio,
        beam_size=max(1, args.beam_size),
        language=None if args.language == "auto" else args.language,
        initial_prompt=args.initial_prompt,
        vad_filter=False,
        word_timestamps=True,
    )
    parts = []
    words = []
    for segment in segments:
        if segment.text and segment.text.strip():
            parts.append(segment.text.strip())
        segment_words = getattr(segment, "words", None) or []
        for word in segment_words:
            raw_word = getattr(word, "word", "") or ""
            clean_word = raw_word.strip()
            start = getattr(word, "start", None)
            end = getattr(word, "end", None)
            if clean_word and isinstance(start, (int, float)) and isinstance(end, (int, float)):
                words.append({"text": clean_word, "start": float(start), "end": float(end)})

    text = " ".join(parts)
    print(
        json.dumps(
            {
                "text": " ".join(text.split()),
                "words": words,
                "language": getattr(info, "language", None),
                "language_probability": getattr(info, "language_probability", None),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
