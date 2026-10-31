import { createContext, useContext } from "react";

export const PictureViewportContext = createContext(true);
export const usePicturesNearViewport = () => useContext(PictureViewportContext);
