// Phone numbers are stored in E.164. Callers say them in many shapes; India (+91) is the default.

export function toE164(input: string | undefined | null, defaultCountry = "91"): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return undefined;
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.length === 10) e164 = `+${defaultCountry}${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) e164 = `+${defaultCountry}${digits.slice(1)}`;
  else if (digits.length === 12 && digits.startsWith(defaultCountry)) e164 = `+${digits}`;
  else return undefined;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : undefined;
}

// "+918056203528" -> "+91 ••••• •3528": enough to recognise, not enough to dial.
export function maskPhone(e164: string): string {
  const match = e164.match(/^\+(\d{1,3}?)(\d{10})$/);
  if (!match) return `${e164.slice(0, 3)}••••${e164.slice(-4)}`;
  return `+${match[1]} ••••• •${match[2].slice(-4)}`;
}
