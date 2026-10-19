# Publish the shared library without application authentication

The initial API provides public read access to the same songs for everyone through an HTTPS tunnel, without login, application sessions, or personalized features. A future frontend may keep a username locally, but it does not establish identity or permissions; backend user features are deferred until there is a concrete use case. Public tunnel access is intentional, while library maintenance remains an operator task rather than a public write API.
