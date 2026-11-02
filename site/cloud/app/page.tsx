import markup from '@/data/reader.json';

export default function Reader() {
  return <><div dangerouslySetInnerHTML={{ __html: markup }} /><script type="module" src="/app.js" /></>;
}
