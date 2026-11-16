import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { loadParticle, saveParticle } from '../reader/lessonStorage';
import type { Particle } from '../reader/lessons';

/** The polite ending Thai lessons are made for, and a way to change it; kept on the phone, so it is the same next time. */
export function useParticle(): [Particle, (particle: Particle) => void] {
  const [particle, setParticle] = useState<Particle>('khrap');
  useFocusEffect(useCallback(() => {
    let live = true;
    loadParticle().then((p) => { if (live) setParticle(p); });
    return () => { live = false; };
  }, []));
  const choose = useCallback((next: Particle) => {
    setParticle(next);
    saveParticle(next);
  }, []);
  return [particle, choose];
}
