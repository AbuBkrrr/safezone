/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // static files in ./out: deploy to any static host, or serve offline from a phone
  trailingSlash: true,
};
export default nextConfig;
