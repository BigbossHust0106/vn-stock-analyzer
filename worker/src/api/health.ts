export function healthResponse() {
  return Response.json(
    {
      status: 'ok',
      message: 'Xin chào từ Workers API',
      disclaimer: 'Chỉ mang tính tham khảo, không phải lời khuyên đầu tư.',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
