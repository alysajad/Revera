const pad = (value: number) => String(value).padStart(2, "0");

export const formatDate = (value: Date | string | null | undefined) => {
  if (!value) return "";
  if (typeof value === "string") {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

export const parseDate = (value: string) => {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? `${year}-${month}-${day}` : null;
};

export const parseDateTime = (value: string) => {
  const match = value.trim().match(/^(\d{2}\/\d{2}\/\d{4})[ ,]+([01]\d|2[0-3]):([0-5]\d)$/);
  const date = match && parseDate(match[1]);
  if (!date) return null;
  const parsed = new Date(`${date}T${match[2]}:${match[3]}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
