import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { message: "wait-time endpoint placeholder" },
    { status: 200 },
  );
}
