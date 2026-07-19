"use client";

import { createContext, useContext, useState } from "react";

const RealPathnameContext = createContext<{
  realPathname: string;
  setRealPathname: (p: string) => void;
}>({ realPathname: "", setRealPathname: () => {} });

export function RealPathnameProvider({ children }: { children: React.ReactNode }) {
  const [realPathname, setRealPathname] = useState("");
  return (
    <RealPathnameContext.Provider value={{ realPathname, setRealPathname }}>
      {children}
    </RealPathnameContext.Provider>
  );
}

export function useRealPathname() {
  return useContext(RealPathnameContext);
}
