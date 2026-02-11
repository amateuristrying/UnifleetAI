import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type OpsKey = 'zambia' | 'tanzania';

export interface OpsContextType {
    ops: OpsKey;
    setOps: (val: OpsKey) => void;
}

const OpsContext = createContext<OpsContextType | undefined>(undefined);

export function OpsProvider({ children }: { children: ReactNode }) {
    const [ops, setOps] = useState<OpsKey>('zambia'); // Default to Zambia
    return <OpsContext.Provider value={{ ops, setOps }}>{children}</OpsContext.Provider>;
}

export function useOps(): OpsContextType {
    const ctx = useContext(OpsContext);
    if (!ctx) throw new Error('useOps must be used within OpsProvider');
    return ctx;
}
