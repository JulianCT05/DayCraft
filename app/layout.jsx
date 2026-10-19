import "./globals.css";

export const metadata = { title: "DayCraft" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
