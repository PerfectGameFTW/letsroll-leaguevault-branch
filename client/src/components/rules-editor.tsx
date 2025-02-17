import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';
import { ErrorBoundary } from 'react-error-boundary';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface RulesEditorProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
}

function EditorErrorFallback({ error }: { error: Error }) {
  return (
    <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
      <AlertCircle className="h-5 w-5" />
      <p>Error loading editor: {error.message}</p>
    </div>
  );
}

export function RulesEditor({ content, onChange, readOnly = false }: RulesEditorProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="space-y-4">
      <ErrorBoundary FallbackComponent={EditorErrorFallback}>
        <div className="min-h-[200px] border rounded-lg p-4 bg-background">
          {isLoading && (
            <div className="flex justify-center items-center h-[200px]">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          <div className={isLoading ? 'opacity-0' : 'opacity-100 transition-opacity'}>
            <CKEditor
              editor={ClassicEditor}
              data={content}
              disabled={readOnly}
              onReady={() => {
                setIsLoading(false);
              }}
              onChange={(event, editor) => {
                try {
                  const data = editor.getData();
                  onChange(data);
                } catch (error) {
                  console.error('CKEditor onChange error:', error);
                }
              }}
              config={{
                toolbar: readOnly ? [] : [
                  'heading',
                  '|',
                  'bold',
                  'italic',
                  '|',
                  'bulletedList',
                  'numberedList',
                  '|',
                  'undo',
                  'redo'
                ],
                placeholder: 'Enter league rules here...',
              }}
            />
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}