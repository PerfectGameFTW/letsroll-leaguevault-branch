import { Textarea } from "@/components/ui/textarea";

interface RulesEditorProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
}

export function RulesEditor({ content, onChange, readOnly = false }: RulesEditorProps) {
  return (
    <Textarea
      value={content || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
      placeholder="Enter league rules here..."
      className="min-h-[200px] resize-y"
    />
  );
}