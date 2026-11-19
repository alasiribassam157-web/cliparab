"use client";

import { createContext, useContext } from "react";
import type { User } from "./types";

export const UserContext = createContext<{ user: User | null; refresh: () => void }>({ user: null, refresh: () => {} });
export const useUser = () => useContext(UserContext);
