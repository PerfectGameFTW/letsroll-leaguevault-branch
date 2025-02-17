import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from '@tiptap/extension-text-align';
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";

interface RulesEditorProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
}

export function RulesEditor({ content, onChange, readOnly = false }: RulesEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: content || '',
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      console.log('Editor content updated:', html); // Debug log
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-xl focus:outline-none max-w-none',
        spellcheck: 'true',
      },
    },
  });

  if (!editor) {
    return null;
  }

  const handleButtonClick = (action: () => boolean) => {
    editor.chain().focus().run(() => {
      action();
      return true;
    });
  };

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="border rounded-lg p-2 flex flex-wrap gap-2 bg-background">
          <Toggle
            size="sm"
            pressed={editor.isActive("bold")}
            onPressedChange={() => handleButtonClick(() => editor.chain().toggleBold().run())}
            aria-label="Toggle bold"
          >
            <Bold className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("italic")}
            onPressedChange={() => handleButtonClick(() => editor.chain().toggleItalic().run())}
            aria-label="Toggle italic"
          >
            <Italic className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("bulletList")}
            onPressedChange={() => handleButtonClick(() => editor.chain().toggleBulletList().run())}
            aria-label="Toggle bullet list"
          >
            <List className="h-4 w-4" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("orderedList")}
            onPressedChange={() => handleButtonClick(() => editor.chain().toggleOrderedList().run())}
            aria-label="Toggle ordered list"
          >
            <ListOrdered className="h-4 w-4" />
          </Toggle>
          <div className="flex border-l pl-2 ml-2">
            <Toggle
              size="sm"
              pressed={editor.isActive({ textAlign: "left" })}
              onPressedChange={() => handleButtonClick(() => editor.chain().setTextAlign("left").run())}
              aria-label="Align left"
            >
              <AlignLeft className="h-4 w-4" />
            </Toggle>
            <Toggle
              size="sm"
              pressed={editor.isActive({ textAlign: "center" })}
              onPressedChange={() => handleButtonClick(() => editor.chain().setTextAlign("center").run())}
              aria-label="Align center"
            >
              <AlignCenter className="h-4 w-4" />
            </Toggle>
            <Toggle
              size="sm"
              pressed={editor.isActive({ textAlign: "right" })}
              onPressedChange={() => handleButtonClick(() => editor.chain().setTextAlign("right").run())}
              aria-label="Align right"
            >
              <AlignRight className="h-4 w-4" />
            </Toggle>
          </div>
        </div>
      )}
      <div 
        className={`border rounded-lg p-4 min-h-[200px] ${
          !readOnly ? "prose-sm sm:prose lg:prose-lg xl:prose-xl cursor-text bg-background" : "prose"
        } max-w-none focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2`}
        onClick={() => !readOnly && editor.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}