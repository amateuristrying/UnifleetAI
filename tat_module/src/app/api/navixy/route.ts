import { NextRequest, NextResponse } from 'next/server';

const NAVIXY_BASE_URL = 'https://api.navixy.com/v2';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Extract the path after /api/navixy/
    // e.g. /api/navixy/history/tracker/list -> /history/tracker/list
    const path = request.nextUrl.pathname.replace('/api/navixy', '');

    if (!path || path === '/') {
      return NextResponse.json({ success: false, error: 'Missing endpoint in path' }, { status: 400 });
    }

    const navixyUrl = new URL(`${NAVIXY_BASE_URL}${path}`);

    // Append all query parameters to the Navixy URL
    searchParams.forEach((value, key) => {
      navixyUrl.searchParams.append(key, value);
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(navixyUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy GET Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch from Navixy' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Extract the path after /api/navixy/
    // e.g. /api/navixy/history/tracker/list -> /history/tracker/list
    const path = request.nextUrl.pathname.replace('/api/navixy', '');
    const navixyUrl = `${NAVIXY_BASE_URL}${path}`;

    console.log(`[API Proxy] POST to ${navixyUrl}`);

    const response = await fetch(navixyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy POST Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch from Navixy' }, { status: 500 });
  }
}
