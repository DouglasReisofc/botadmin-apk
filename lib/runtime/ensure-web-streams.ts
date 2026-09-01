import {
  ReadableStream as NodeReadableStream,
  TransformStream as NodeTransformStream,
  WritableStream as NodeWritableStream,
} from "node:stream/web";

type GlobalStreams = {
  ReadableStream?: typeof NodeReadableStream;
  TransformStream?: typeof NodeTransformStream;
  WritableStream?: typeof NodeWritableStream;
};

const globalStreams = globalThis as typeof globalThis & GlobalStreams;

// Force native web streams to avoid mixed stream implementations at runtime.
if (globalStreams.ReadableStream !== NodeReadableStream) {
  globalStreams.ReadableStream = NodeReadableStream;
}
if (globalStreams.TransformStream !== NodeTransformStream) {
  globalStreams.TransformStream = NodeTransformStream;
}
if (globalStreams.WritableStream !== NodeWritableStream) {
  globalStreams.WritableStream = NodeWritableStream;
}

export {};
