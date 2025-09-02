import { isPortableVersion } from "@/services/cmds";
import { useLocalStorageState } from "ahooks";
import { useEffect } from "react";

export const usePortable = () => {
  const [portable, setPortable] = useLocalStorageState("portable", {
    defaultValue: false,
    listenStorageChange: true,
  });

  useEffect(() => {
    isPortableVersion().then((isPortable) => {
      setPortable(isPortable);
    });
  }, []);

  return { portable };
};
