import { MutableRefObject, useRef } from "react";

interface Handler {
  open: () => void;
  close: () => void;
}

export type ModalHandler = MutableRefObject<Handler>;

const useModalHandler = (): ModalHandler => {
  return useRef({ open: () => {}, close: () => {} });
};

export default useModalHandler;
