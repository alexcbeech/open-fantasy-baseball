import { handleImageRequest } from "@/lib/images/route";

export const runtime = "nodejs";
type Context = { params: Promise<{ teamId: string }> };
export async function PUT(request: Request, { params }: Context) {
  return handleImageRequest(request, (await params).teamId);
}
export const DELETE = PUT;
