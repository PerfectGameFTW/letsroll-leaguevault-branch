import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Mail, Pencil, ChevronDown } from "lucide-react";
import type { EmailTemplate } from "@shared/schema";

type ToggleMutation = UseMutationResult<
  unknown,
  Error,
  { id: number; active: boolean },
  unknown
>;

interface EmailTemplatesListProps {
  templates: EmailTemplate[];
  expandedId: number | null;
  setExpandedId: Dispatch<SetStateAction<number | null>>;
  openEditor: (template: EmailTemplate) => void;
  toggleMutation: ToggleMutation;
}

export function EmailTemplatesList({
  templates,
  expandedId,
  setExpandedId,
  openEditor,
  toggleMutation,
}: EmailTemplatesListProps) {
  return (
    <div className="rounded-lg border divide-y">
      {templates.map((template) => {
        const isExpanded = expandedId === template.id;
        return (
          <div key={template.id}>
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : template.id)}
            >
              <Mail className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-sm flex-1 truncate">{template.name}</span>
              <Badge variant={template.active ? "default" : "secondary"} className="shrink-0">
                {template.active ? "Active" : "Inactive"}
              </Badge>
              <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </button>
            {isExpanded && (
              <div className="px-4 pb-4 pt-1 space-y-3 bg-muted/30">
                {template.description && (
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                )}
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</span>
                  <p className="text-sm mt-0.5">{template.subject}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body Preview</span>
                  <p className="text-sm mt-0.5 line-clamp-4 text-muted-foreground whitespace-pre-line">{template.body}</p>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <Button variant="outline" size="sm" onClick={() => openEditor(template)}>
                    <Pencil className="size-3.5 mr-1.5" />
                    Edit Template
                  </Button>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-muted-foreground">{template.active ? "Active" : "Inactive"}</span>
                    <Switch
                      checked={template.active}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: template.id, active: checked })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
