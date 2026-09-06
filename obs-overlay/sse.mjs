// Incremental UTF-8-safe SSE framing. Comments count as liveness, not state.
export class SseParser {
  constructor(onEvent) { this.buffer = ''; this.onEvent = onEvent; }
  push(text) {
    this.buffer += text;
    let match;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      if (match.index > 65536) throw new Error('Oversized SSE event');
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      let event = 'message'; const data = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '');
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) this.onEvent(event, data.join('\n'));
    }
    if (this.buffer.length > 65536) throw new Error('Oversized SSE buffer');
  }
}
