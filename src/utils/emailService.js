const sgMail = require('@sendgrid/mail');

// Initialize SendGrid if API key is available
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@hotelmanagement.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@hotelmanagement.com';
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Send email notification
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (optional)
 */
const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.SENDGRID_API_KEY || !FROM_EMAIL) {
    if (IS_PROD) {
      console.error('Email provider not configured. Cannot send email.');
      return { success: false, error: 'Email provider not configured' };
    }
    // In development, log the email instead of sending
    console.log('\n=== EMAIL NOTIFICATION (DEV MODE) ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Content:', text || html);
    console.log('=====================================\n');
    return { success: true, devMode: true };
  }

  try {
    await sgMail.send({
      to,
      from: FROM_EMAIL,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML tags for text version
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to send email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email template for booking confirmation (User)
 */
const getBookingConfirmationEmail = (booking) => {
  const checkIn = new Date(booking.checkIn).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const checkOut = new Date(booking.checkOut).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    subject: `Booking Confirmed - Booking #${booking._id?.toString().slice(-8) || 'N/A'}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .detail-label { font-weight: bold; color: #666; }
          .detail-value { color: #333; }
          .status-badge { display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; }
          .status-confirmed { background: #d4edda; color: #155724; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Booking Confirmed!</h1>
            <p>Your reservation has been confirmed</p>
          </div>
          <div class="content">
            <p>Dear ${booking.guestName},</p>
            <p>We're delighted to confirm your booking with us!</p>
            
            <div class="booking-details">
              <h3>Booking Details</h3>
              <div class="detail-row">
                <span class="detail-label">Booking ID:</span>
                <span class="detail-value">#${booking._id?.toString().slice(-8) || 'N/A'}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-In:</span>
                <span class="detail-value">${checkIn}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-Out:</span>
                <span class="detail-value">${checkOut}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests:</span>
                <span class="detail-value">${booking.guests} guest(s)</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Rooms:</span>
                <span class="detail-value">${booking.rooms || 1} room(s)</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total Amount:</span>
                <span class="detail-value">₹${Number(booking.totalPrice || 0).toLocaleString('en-IN')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Payment Status:</span>
                <span class="detail-value">
                  <span class="status-badge ${booking.paymentStatus === 'paid' ? 'status-confirmed' : ''}">
                    ${booking.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
                  </span>
                </span>
              </div>
            </div>

            <p>We look forward to welcoming you!</p>
            <p>If you have any questions or need to make changes, please contact us.</p>
            
            <div class="footer">
              <p>Best regards,<br>Hotel Management Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for payment confirmation (User)
 */
const getPaymentConfirmationEmail = (booking) => {
  return {
    subject: `Payment Received - Booking #${booking._id?.toString().slice(-8) || 'N/A'}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .payment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .amount { font-size: 32px; font-weight: bold; color: #11998e; text-align: center; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Payment Received!</h1>
            <p>Your payment has been successfully processed</p>
          </div>
          <div class="content">
            <p>Dear ${booking.guestName},</p>
            <p>We have successfully received your payment for the following booking:</p>
            
            <div class="payment-details">
              <div class="amount">₹${Number(booking.totalPrice || 0).toLocaleString('en-IN')}</div>
              <p style="text-align: center;">Booking ID: #${booking._id?.toString().slice(-8) || 'N/A'}</p>
              <p style="text-align: center;">Payment Method: ${booking.paymentMethod === 'online' ? 'Online Payment' : 'Pay at Check-in'}</p>
            </div>

            <p>Your booking is now confirmed and ready. We look forward to hosting you!</p>
            
            <div class="footer">
              <p>Best regards,<br>Hotel Management Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for booking cancellation (User)
 */
const getBookingCancellationEmail = (booking) => {
  return {
    subject: `Booking Cancelled - Booking #${booking._id?.toString().slice(-8) || 'N/A'}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Booking Cancelled</h1>
          </div>
          <div class="content">
            <p>Dear ${booking.guestName},</p>
            <p>Your booking #${booking._id?.toString().slice(-8) || 'N/A'} has been cancelled as requested.</p>
            <p>If you made a payment, the refund will be processed according to our cancellation policy.</p>
            <p>We hope to serve you in the future!</p>
            <div class="footer">
              <p>Best regards,<br>Hotel Management Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for check-in notification (User)
 */
const getCheckInEmail = (booking) => {
  return {
    subject: `Welcome! Check-In Confirmed - Booking #${booking._id?.toString().slice(-8) || 'N/A'}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome!</h1>
            <p>You have successfully checked in</p>
          </div>
          <div class="content">
            <p>Dear ${booking.guestName},</p>
            <p>Welcome! Your check-in for booking #${booking._id?.toString().slice(-8) || 'N/A'} has been confirmed.</p>
            <p>We hope you have a pleasant stay with us. If you need anything, please don't hesitate to contact our front desk.</p>
            <div class="footer">
              <p>Best regards,<br>Hotel Management Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for check-out notification (User)
 */
const getCheckOutEmail = (booking) => {
  return {
    subject: `Thank You! Check-Out Confirmed - Booking #${booking._id?.toString().slice(-8) || 'N/A'}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Thank You!</h1>
            <p>Your check-out has been confirmed</p>
          </div>
          <div class="content">
            <p>Dear ${booking.guestName},</p>
            <p>Thank you for staying with us! Your check-out for booking #${booking._id?.toString().slice(-8) || 'N/A'} has been confirmed.</p>
            <p>We hope you enjoyed your stay and look forward to welcoming you back soon!</p>
            <div class="footer">
              <p>Best regards,<br>Hotel Management Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for service booking confirmation (User)
 */
const getServiceBookingConfirmationEmail = (serviceBooking) => {
  const bookingDate = new Date(serviceBooking.date).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    subject: `Service Booking Confirmed - ${serviceBooking.serviceName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .detail-label { font-weight: bold; color: #666; }
          .detail-value { color: #333; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Service Booking Confirmed!</h1>
            <p>Your reservation has been confirmed</p>
          </div>
          <div class="content">
            <p>Dear ${serviceBooking.guestName},</p>
            <p>We're delighted to confirm your service booking!</p>
            
            <div class="booking-details">
              <h3>Booking Details</h3>
              <div class="detail-row">
                <span class="detail-label">Service:</span>
                <span class="detail-value">${serviceBooking.serviceName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Date:</span>
                <span class="detail-value">${bookingDate}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Time:</span>
                <span class="detail-value">${serviceBooking.time}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests:</span>
                <span class="detail-value">${serviceBooking.guests} guest(s)</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total Amount:</span>
                <span class="detail-value">₹${Number(serviceBooking.totalPrice || 0).toLocaleString('en-IN')}</span>
              </div>
              ${serviceBooking.specialRequests ? `
              <div class="detail-row">
                <span class="detail-label">Special Requests:</span>
                <span class="detail-value">${serviceBooking.specialRequests}</span>
              </div>
              ` : ''}
            </div>

            <p>We look forward to serving you!</p>
            
            <div class="footer">
              <p>Best regards,<br>Hotel Management Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for service payment confirmation (User)
 */
const getServicePaymentConfirmationEmail = (serviceBooking) => {
  return {
    subject: `Payment Received - ${serviceBooking.serviceName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .payment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .amount { font-size: 32px; font-weight: bold; color: #11998e; text-align: center; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Payment Received!</h1>
            <p>Your service booking payment has been processed</p>
          </div>
          <div class="content">
            <p>Dear ${serviceBooking.guestName},</p>
            <p>We have successfully received your payment for:</p>
            
            <div class="payment-details">
              <div class="amount">₹${Number(serviceBooking.totalPrice || 0).toLocaleString('en-IN')}</div>
              <p style="text-align: center;">Service: ${serviceBooking.serviceName}</p>
              <p style="text-align: center;">Date: ${new Date(serviceBooking.date).toLocaleDateString('en-IN')}</p>
            </div>

            <p>Your service booking is now confirmed. We look forward to serving you!</p>
            
            <div class="footer">
              <p>Best regards,<br>Hotel Management Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for new booking notification (Admin)
 */
const getNewBookingAdminEmail = (booking) => {
  const checkIn = new Date(booking.checkIn).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const checkOut = new Date(booking.checkOut).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    subject: `New Booking Received - Booking #${booking._id?.toString().slice(-8) || 'N/A'}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .detail-label { font-weight: bold; color: #666; }
          .detail-value { color: #333; }
          .action-button { display: inline-block; background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Booking Received!</h1>
            <p>Action required: Review and approve booking</p>
          </div>
          <div class="content">
            <p>Hello Admin,</p>
            <p>A new booking has been received and requires your attention:</p>
            
            <div class="booking-details">
              <h3>Booking Details</h3>
              <div class="detail-row">
                <span class="detail-label">Booking ID:</span>
                <span class="detail-value">#${booking._id?.toString().slice(-8) || 'N/A'}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guest Name:</span>
                <span class="detail-value">${booking.guestName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Email:</span>
                <span class="detail-value">${booking.guestEmail}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Phone:</span>
                <span class="detail-value">${booking.guestPhone}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-In:</span>
                <span class="detail-value">${checkIn}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Check-Out:</span>
                <span class="detail-value">${checkOut}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests:</span>
                <span class="detail-value">${booking.guests} guest(s)</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total Amount:</span>
                <span class="detail-value">₹${Number(booking.totalPrice || 0).toLocaleString('en-IN')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Status:</span>
                <span class="detail-value">${booking.status}</span>
              </div>
            </div>

            <p>Please review this booking in the admin dashboard and take appropriate action.</p>
            
            <div class="footer">
              <p>Hotel Management System</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for new service booking notification (Admin)
 */
const getNewServiceBookingAdminEmail = (serviceBooking) => {
  const bookingDate = new Date(serviceBooking.date).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    subject: `New Service Booking - ${serviceBooking.serviceName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .booking-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .detail-label { font-weight: bold; color: #666; }
          .detail-value { color: #333; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Service Booking!</h1>
            <p>Action required: Review service booking</p>
          </div>
          <div class="content">
            <p>Hello Admin,</p>
            <p>A new service booking has been received:</p>
            
            <div class="booking-details">
              <h3>Booking Details</h3>
              <div class="detail-row">
                <span class="detail-label">Service:</span>
                <span class="detail-value">${serviceBooking.serviceName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guest Name:</span>
                <span class="detail-value">${serviceBooking.guestName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Email:</span>
                <span class="detail-value">${serviceBooking.guestEmail}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Phone:</span>
                <span class="detail-value">${serviceBooking.guestPhone}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Date:</span>
                <span class="detail-value">${bookingDate}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Time:</span>
                <span class="detail-value">${serviceBooking.time}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Guests:</span>
                <span class="detail-value">${serviceBooking.guests} guest(s)</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Total Amount:</span>
                <span class="detail-value">₹${Number(serviceBooking.totalPrice || 0).toLocaleString('en-IN')}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Status:</span>
                <span class="detail-value">${serviceBooking.status}</span>
              </div>
            </div>

            <p>Please review this booking in the admin dashboard.</p>
            
            <div class="footer">
              <p>Hotel Management System</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

/**
 * Email template for payment received notification (Admin)
 */
const getPaymentReceivedAdminEmail = (booking, isServiceBooking = false) => {
  const bookingType = isServiceBooking ? 'Service Booking' : 'Room Booking';
  const bookingId = booking._id?.toString().slice(-8) || 'N/A';

  return {
    subject: `Payment Received - ${bookingType} #${bookingId}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .payment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .amount { font-size: 32px; font-weight: bold; color: #11998e; text-align: center; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Payment Received!</h1>
            <p>${bookingType} payment confirmed</p>
          </div>
          <div class="content">
            <p>Hello Admin,</p>
            <p>A payment has been successfully received:</p>
            
            <div class="payment-details">
              <div class="amount">₹${Number(booking.totalPrice || 0).toLocaleString('en-IN')}</div>
              <p style="text-align: center;">${bookingType} ID: #${bookingId}</p>
              <p style="text-align: center;">Guest: ${booking.guestName}</p>
              <p style="text-align: center;">Email: ${booking.guestEmail}</p>
              <p style="text-align: center;">Payment Method: ${booking.paymentMethod === 'online' ? 'Online Payment' : 'Pay at Check-in'}</p>
            </div>

            <p>This booking is now confirmed and ready.</p>
            
            <div class="footer">
              <p>Hotel Management System</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };
};

// Export notification functions
module.exports = {
  sendEmail,
  // User notifications
  sendBookingConfirmation: async (booking) => {
    const email = getBookingConfirmationEmail(booking);
    return await sendEmail({
      to: booking.guestEmail,
      ...email,
    });
  },
  sendPaymentConfirmation: async (booking) => {
    const email = getPaymentConfirmationEmail(booking);
    return await sendEmail({
      to: booking.guestEmail,
      ...email,
    });
  },
  sendBookingCancellation: async (booking) => {
    const email = getBookingCancellationEmail(booking);
    return await sendEmail({
      to: booking.guestEmail,
      ...email,
    });
  },
  sendCheckInNotification: async (booking) => {
    const email = getCheckInEmail(booking);
    return await sendEmail({
      to: booking.guestEmail,
      ...email,
    });
  },
  sendCheckOutNotification: async (booking) => {
    const email = getCheckOutEmail(booking);
    return await sendEmail({
      to: booking.guestEmail,
      ...email,
    });
  },
  sendServiceBookingConfirmation: async (serviceBooking) => {
    const email = getServiceBookingConfirmationEmail(serviceBooking);
    return await sendEmail({
      to: serviceBooking.guestEmail,
      ...email,
    });
  },
  sendServicePaymentConfirmation: async (serviceBooking) => {
    const email = getServicePaymentConfirmationEmail(serviceBooking);
    return await sendEmail({
      to: serviceBooking.guestEmail,
      ...email,
    });
  },
  // Admin notifications
  sendNewBookingAdminNotification: async (booking) => {
    const email = getNewBookingAdminEmail(booking);
    return await sendEmail({
      to: ADMIN_EMAIL,
      ...email,
    });
  },
  sendNewServiceBookingAdminNotification: async (serviceBooking) => {
    const email = getNewServiceBookingAdminEmail(serviceBooking);
    return await sendEmail({
      to: ADMIN_EMAIL,
      ...email,
    });
  },
  sendPaymentReceivedAdminNotification: async (booking, isServiceBooking = false) => {
    const email = getPaymentReceivedAdminEmail(booking, isServiceBooking);
    return await sendEmail({
      to: ADMIN_EMAIL,
      ...email,
    });
  },
};
