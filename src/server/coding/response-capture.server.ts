import { createHash } from "node:crypto";

// Herdr provides a terminal screen, not assistant-role events. Never infer a
// response from screen differences: redraws, prompt echoes and scrollback all
// look like new output. Frame each direct-message reply with a durable token.
export function responseFrame(inputId: string) {
  const token = createHash("sha256").update(inputId).digest("hex").slice(0, 24);
  return {
    token,
    begin: `ROOST_REPLY_${token}_BEGIN`,
    end: `ROOST_REPLY_${token}_END`,
  };
}

export function responseCaptureInstruction(inputId: string) {
  const { token } = responseFrame(inputId);
  // Full delimiters never appear in the prompt; a verbatim echo cannot pass.
  return `For job-page response capture, enclose only your final answer between two standalone plain-text lines. Construct the opening line by concatenating "ROOST_REPLY_", "${token}", and "_BEGIN" without spaces; construct the closing line with the same prefix and token and "_END". Do not quote these instructions or print the delimiters anywhere else. This formatting request does not change task authorization.`;
}

export function captureWorkerResponse(
  inputId: string,
  baseline: string,
  snapshot: string,
  submittedPrompt = "",
): string | null {
  const { begin, end } = responseFrame(inputId);
  if (
    [baseline, submittedPrompt].some(
      (text) => text.includes(begin) || text.includes(end),
    )
  )
    return null;
  // Codex renders the first final-answer line with a bullet. Do not remove
  // arbitrary terminal content or use substring matching for frame boundaries.
  const lines = snapshot.replaceAll("\r\n", "\n").split("\n");
  const boundary = (line: string) => line.trim().replace(/^[•●] /, "");
  const starts = lines.flatMap((line, i) =>
    boundary(line) === begin ? [i] : [],
  );
  const ends = lines.flatMap((line, i) => (boundary(line) === end ? [i] : []));
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! <= starts[0]!)
    return null;
  const answer = lines
    .slice(starts[0]! + 1, ends[0])
    .join("\n")
    .trim();
  return answer && !answer.includes(begin) && !answer.includes(end)
    ? answer
    : null;
}
