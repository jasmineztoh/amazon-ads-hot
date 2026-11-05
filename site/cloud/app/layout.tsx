import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Amazon 营销与 AI',
  description: '聚焦 Amazon 广告、营销、流量与 AI 的知识阅读站。',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><head><link rel="stylesheet" href="/style.css" /></head><body>{children}</body></html>;
}
