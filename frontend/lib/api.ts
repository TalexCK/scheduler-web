import { NextResponse } from "next/server";

export function dataServiceError(error: unknown) {
  console.error("数据服务查询失败", error);
  return NextResponse.json({ error: { message: "数据服务暂时不可用" } }, { status: 503 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: { message } }, { status: 400 });
}

export function validIdentifier(value: string, maxLength = 64) {
  return value.length > 0 && value.length <= maxLength && /^[a-z0-9_]+$/.test(value);
}

export function validMonthKey(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number.parseInt(match[2], 10);
  return month >= 1 && month <= 12;
}
