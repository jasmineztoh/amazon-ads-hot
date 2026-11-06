import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '亚马逊广告投放',
  description: '给正在做和准备做亚马逊广告投放的人。追踪变化，学习方法，读懂案例。',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><head><link rel="stylesheet" href="/style.css" /></head><body>{children}</body></html>;
}
