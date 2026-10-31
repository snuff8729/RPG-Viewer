import { createContext, useContext } from "react";
import type { VoiceSound } from "@/core/live/types";
import type { ReaderItem } from "@/core/live/reader";
import { NO_VOICES } from "@/core/live/voice";
import { VoiceAutoPosition } from "./voiceAuto";

export type VoiceMessage = Extract<ReaderItem, { kind: "message" }>;
interface ReaderVoice {
  sounds: (item: VoiceMessage) => readonly VoiceSound[];
  play: (item: VoiceMessage) => void;
  stop: () => void;
  position: VoiceAutoPosition;
}
export const ReaderVoiceContext = createContext<ReaderVoice>({ sounds: () => NO_VOICES, play: () => {}, stop: () => {}, position: new VoiceAutoPosition() });
export const useReaderVoice = () => useContext(ReaderVoiceContext);
