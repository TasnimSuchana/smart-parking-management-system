import { useEffect } from 'react';
export const useTitle = (t) => useEffect(() => { document.title = t ? `${t} | Smart Parking` : 'Smart Parking'; }, [t]);
