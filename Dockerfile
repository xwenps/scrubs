# Scrubs is a static site: there is nothing to compile, so there is no build
# stage. The image is nginx plus the source tree, and the per-environment
# configuration is written at container start rather than baked in — which is
# what lets the same image be promoted between environments.

FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Scrubs" \
      org.opencontainers.image.description="Count worked and scheduled shifts from Google Calendar" \
      org.opencontainers.image.source="https://github.com/xwenps/scrubs"

# The application, minus anything only useful in development. See .dockerignore.
COPY index.html /usr/share/nginx/html/
COPY assets/    /usr/share/nginx/html/assets/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
COPY views/     /usr/share/nginx/html/views/
COPY config/    /usr/share/nginx/html/config/

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY scripts/write-runtime-config.sh /usr/local/bin/write-runtime-config.sh
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/write-runtime-config.sh /usr/local/bin/entrypoint.sh \
    # nginx runs unprivileged; it needs to rewrite the generated config on start.
    && chown -R nginx:nginx /usr/share/nginx/html/config

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
