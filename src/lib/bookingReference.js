// Short, consistent display reference derived from the saved appointment UUID.
// The UUID remains the actual database identifier.
export function bookingReference(id) {
 const hex=String(id||'').replace(/-/g,'').toUpperCase();
 return /^[0-9A-F]{32}$/.test(hex)?'LYN-'+hex.slice(0,6)+'-'+hex.slice(-6):String(id||'');
}
