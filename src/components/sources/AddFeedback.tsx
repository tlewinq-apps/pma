"use client";
import { ClipboardPaste, FileText, Mic } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropZone } from "./DropZone";
import { RecordingForm } from "./RecordingForm";

/** The ways to add feedback by hand. Slack, the widget and the API arrive on their own and show up under Received. */
export function AddFeedback({ demo = true, audienceOne = "member" }: { demo?: boolean; audienceOne?: string }) {
  return (
    <Tabs defaultValue="paste" className="surface p-5">
      {/* Full width with no icons on a phone, so all three tabs fit inside the card. */}
      <TabsList className="w-full sm:w-fit">
        <TabsTrigger value="paste"><ClipboardPaste aria-hidden className="max-sm:hidden" />Paste text</TabsTrigger>
        <TabsTrigger value="files"><FileText aria-hidden className="max-sm:hidden" />Files</TabsTrigger>
        <TabsTrigger value="recording"><Mic aria-hidden className="max-sm:hidden" />Recording</TabsTrigger>
      </TabsList>
      <TabsContent value="paste"><DropZone mode="paste" /></TabsContent>
      <TabsContent value="files"><DropZone mode="files" /></TabsContent>
      <TabsContent value="recording"><RecordingForm demo={demo} audienceOne={audienceOne} /></TabsContent>
    </Tabs>
  );
}
