export async function uploadImageToImgBB(image, apiKey) {
  if (!apiKey) {
    const error = new Error("Image upload is not configured. Add IMGBB_API_KEY on the server.");
    error.status = 503;
    throw error;
  }
  if (typeof image !== "string" || !image.trim() || image.length > 8_000_000) {
    const error = new Error("Choose an image smaller than 6 MB.");
    error.status = 400;
    throw error;
  }
  const form = new FormData();
  form.append("image", image.replace(/^data:image\/\w+;base64,/, ""));
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: "POST",
    body: form,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success || !result?.data?.url) {
    const error = new Error("Image upload failed. Please try again.");
    error.status = 502;
    throw error;
  }
  return result.data.url;
}
