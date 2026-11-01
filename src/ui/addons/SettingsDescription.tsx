import { Button } from "@/components/ui/button";
import { CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
export function SettingsDescription({ summary, detail }: { summary: string; detail: string }) {
  return (
    <div className="space-y-1">
      <CardDescription>{summary}</CardDescription>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground">
            자세히
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 text-sm text-muted-foreground">{detail}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}
