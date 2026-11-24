import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export interface MarkedRange {
  from: number;
  to: number;
}

export const setMarkedRangesEffect = StateEffect.define<MarkedRange[]>();

const markDecoration = Decoration.mark({
  class: "vault-agent-marked-text",
});

export const markedRangesField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setMarkedRangesEffect)) {
        const docLen = tr.state.doc.length;
        const sorted = [...effect.value]
          .map((r) => ({
            from: Math.max(0, Math.min(r.from, docLen)),
            to: Math.max(0, Math.min(r.to, docLen)),
          }))
          .filter((r) => r.to > r.from)
          .sort((a, b) => a.from - b.from || a.to - b.to);

        const builder = new RangeSetBuilder<Decoration>();
        let cursor = 0;
        for (const range of sorted) {
          const from = Math.max(range.from, cursor);
          if (range.to > from) {
            builder.add(from, range.to, markDecoration);
            cursor = range.to;
          }
        }
        next = builder.finish();
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
