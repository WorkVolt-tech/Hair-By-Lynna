// Durations remain stored as total minutes in Supabase.
// This module only converts between the friendly hours/minutes UI and storage.
export function durationParts(totalMinutes) {
  const total = Number(totalMinutes);
  if (!Number.isInteger(total) || total < 0) return { hours: 0, minutes: 0 };
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export function durationTotal(hours, minutes) {
  // Don't silently treat an empty or invalid field as zero.
  if (String(hours).trim() === '' || String(minutes).trim() === '') return null;
  const h = Number(hours);
  const m = Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m >= 60) return null;
  const total = h * 60 + m;
  return total >= 15 && total <= 960 ? total : null;
}

export function formatDuration(totalMinutes, language = 'en') {
  const total = Number(totalMinutes);
  if (!Number.isInteger(total) || total < 0) return '—';
  const { hours, minutes } = durationParts(total);
  if (language === 'fr') {
    return [hours ? `${hours} h` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' ') || '0 min';
  }
  return [hours ? `${hours} ${hours === 1 ? 'hr' : 'hrs'}` : '',
    minutes ? `${minutes} ${minutes === 1 ? 'min' : 'mins'}` : ''].filter(Boolean).join(' ') || '0 mins';
}
