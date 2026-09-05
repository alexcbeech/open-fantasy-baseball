import { handleImageRequest } from "@/lib/images/route";

export const runtime = "nodejs";
export async function PUT(request: Request) { return handleImageRequest(request); }
export async function DELETE(request: Request) { return handleImageRequest(request); }
