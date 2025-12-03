export const disableWebViewShortcuts = () => {
  const handleKeydown = (event: KeyboardEvent) => {
    const disabledShortcuts =
      ["F5", "F7"].includes(event.key) ||
      (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) ||
      ((event.ctrlKey || event.metaKey) &&
        ["F", "G", "H", "J", "P", "Q", "R", "U"].includes(
          event.key.toUpperCase(),
        ));

    if (disabledShortcuts) {
      event.preventDefault();
    }
  };

  document.addEventListener("keydown", handleKeydown);

  return () => document.removeEventListener("keydown", handleKeydown);
};
